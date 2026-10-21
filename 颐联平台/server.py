#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
颐联 · 演示服务端(仅用 Python 标准库,不需要 pip 安装)

职责
  1) 提供静态页面
  2) 邮箱验证码登录(QQ SMTP,配置见 .env)
  3) 老人邮箱 ↔ 家属邮箱 绑定:双方各自上限 5;老人至少绑定 1 位家属才能发消息
  4) 老人向已绑定的家属邮箱发消息

运行
  python server.py                 # 默认 8000 端口,可用 PORT 环境变量覆盖
  PORT=3000 python server.py

配置
  .env(参考 .env.example)。.env 已在 .gitignore 中,不要提交。
  SMTP 凭据只留在服务端,永远不会下发给浏览器。
"""

import json
import mimetypes
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import threading
import time
from email.message import EmailMessage
from email.utils import formataddr
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "data.db")
MAX_PER_SIDE = 5
CODE_TTL = 600           # 验证码 10 分钟
CODE_RESEND = 60         # 重发间隔
CODE_HOURLY = 5          # 每小时最多发 5 次
MAX_BODY = 16 * 1024
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


# --------------------------------------------------------------------------- #
# 配置
# --------------------------------------------------------------------------- #
def load_env():
    path = os.path.join(BASE, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()


def env_flag(name, default="false"):
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


# 网站管理员的邮箱(逗号分隔,可多个)。
# 主管(ADMIN_PRIMARY_EMAILS)拥有全部权限;副管(ADMIN_SECONDARY_EMAILS)可以查看与
# 重置用户,但不能删除账号。旧的 ADMIN_EMAILS 仍然兼容,按主管处理。
def admin_emails(name):
    return {
        mail.strip().lower()
        for mail in os.environ.get(name, "").split(",")
        if mail.strip()
    }


ADMIN_PRIMARY = admin_emails("ADMIN_PRIMARY_EMAILS") | admin_emails("ADMIN_EMAILS")
ADMIN_SECONDARY = admin_emails("ADMIN_SECONDARY_EMAILS") - ADMIN_PRIMARY
ADMIN_EMAILS = ADMIN_PRIMARY | ADMIN_SECONDARY


def admin_level(email):
    if email in ADMIN_PRIMARY:
        return "primary"
    if email in ADMIN_SECONDARY:
        return "secondary"
    return None


ADMIN_LABELS = {"primary": "主管", "secondary": "副管"}


# --------------------------------------------------------------------------- #
# 数据库
# --------------------------------------------------------------------------- #
db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.row_factory = sqlite3.Row
DB_LOCK = threading.RLock()

with DB_LOCK:
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            email TEXT PRIMARY KEY,
            role TEXT,
            created_at REAL
        );
        CREATE TABLE IF NOT EXISTS codes (
            email TEXT PRIMARY KEY,
            code TEXT,
            expires_at REAL,
            attempts INTEGER DEFAULT 0,
            sent_at REAL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            email TEXT,
            created_at REAL
        );
        CREATE TABLE IF NOT EXISTS bindings (
            elder TEXT,
            family TEXT,
            created_at REAL,
            PRIMARY KEY (elder, family)
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_email TEXT,
            to_email TEXT,
            body TEXT,
            created_at REAL
        );
        """
    )
    db.commit()
    # 迁移:身份现在跟着“本次登录”走,存在会话里,而不是固定在账号上。
    # (同一个邮箱可以先以老人登录、再以家属登录,用于只有一个邮箱的兜底场景)
    columns = [row[1] for row in db.execute("PRAGMA table_info(sessions)").fetchall()]
    if "role" not in columns:
        db.execute("ALTER TABLE sessions ADD COLUMN role TEXT")
    # 每位用户自己的昵称与头像
    user_columns = [row[1] for row in db.execute("PRAGMA table_info(users)").fetchall()]
    for column in ("nickname", "avatar"):
        if column not in user_columns:
            db.execute(f"ALTER TABLE users ADD COLUMN {column} TEXT")
    db.commit()


def q(sql, args=()):
    with DB_LOCK:
        return db.execute(sql, args).fetchall()


def x(sql, args=()):
    with DB_LOCK:
        cur = db.execute(sql, args)
        db.commit()
        return cur


# --------------------------------------------------------------------------- #
# 邮件
# --------------------------------------------------------------------------- #
def send_code_mail(to_email, code):
    host = os.environ.get("MAIL_SERVER", "smtp.qq.com")
    port = int(os.environ.get("MAIL_PORT", "587"))
    user = os.environ.get("MAIL_USERNAME", "")
    password = os.environ.get("MAIL_PASSWORD", "")
    sender = os.environ.get("MAIL_DEFAULT_SENDER", user)
    if not user or not password:
        raise RuntimeError("服务端未配置 MAIL_USERNAME / MAIL_PASSWORD")

    msg = EmailMessage()
    # EmailMessage 的头部要传普通字符串,它会按 policy 自动编码;
    # 这里不能传 email.header.Header(那是旧 MIMEText 的用法,会直接抛错)
    msg["Subject"] = "颐联登录验证码"
    msg["From"] = formataddr(("颐联", sender))
    msg["To"] = to_email
    msg.set_content(
        "您的颐联登录验证码是:\n\n"
        f"    {code}\n\n"
        "10 分钟内有效,请勿转发给他人。\n"
        "如果不是您本人操作,请忽略这封邮件。\n"
    )

    context = ssl.create_default_context()
    if env_flag("MAIL_USE_SSL"):
        with smtplib.SMTP_SSL(host, port, timeout=25, context=context) as smtp:
            smtp.login(user, password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=25) as smtp:
            smtp.ehlo()
            if env_flag("MAIL_USE_TLS", "true"):
                smtp.starttls(context=context)
                smtp.ehlo()
            smtp.login(user, password)
            smtp.send_message(msg)


# --------------------------------------------------------------------------- #
# 业务
# --------------------------------------------------------------------------- #
class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


RATE = {}
RATE_LOCK = threading.Lock()


def normalise_email(value):
    email = str(value or "").strip().lower()
    if not EMAIL_RE.match(email) or len(email) > 120:
        raise ApiError(400, "请输入有效的邮箱地址")
    return email


def get_user(email):
    row = q("SELECT * FROM users WHERE email=?", (email,))
    return row[0] if row else None


def ensure_user(email):
    if not get_user(email):
        x("INSERT INTO users (email, role, created_at) VALUES (?, NULL, ?)", (email, time.time()))
    return get_user(email)


def session_of(token):
    if not token:
        return None
    row = q("SELECT * FROM sessions WHERE token=?", (token,))
    return row[0] if row else None


def bindings_of(email):
    families = [r["family"] for r in q("SELECT family FROM bindings WHERE elder=? ORDER BY created_at", (email,))]
    elders = [r["elder"] for r in q("SELECT elder FROM bindings WHERE family=? ORDER BY created_at", (email,))]
    return families, elders


def profile(email, role=None):
    user = get_user(email)
    families, elders = bindings_of(email)
    if role not in ("elder", "family"):
        role = None
    nickname = (user["nickname"] if user else "") or ""
    avatar = (user["avatar"] if user else "") or ""
    return {
        "email": email,
        "role": role,
        "nickname": nickname,
        "avatar": avatar,
        "complete": bool(nickname),
        "families": families,
        "elders": elders,
        "max": MAX_PER_SIDE,
        "canSend": role == "elder" and len(families) > 0,
        # 是否已经用“同一个邮箱”兜底绑定过
        "selfBound": any(mail == email for mail in families) or any(mail == email for mail in elders),
        "admin": email in ADMIN_EMAILS,
        "adminLevel": admin_level(email),
        "adminLabel": ADMIN_LABELS.get(admin_level(email), ""),
    }


def set_profile(email, role, nickname, avatar):
    nickname = str(nickname or "").strip()
    avatar = str(avatar or "").strip()
    if not nickname:
        raise ApiError(400, "请填写昵称")
    if len(nickname) > 20:
        raise ApiError(400, "昵称最多 20 个字")
    if avatar.startswith("data:image/"):
        # 上传的图片在前端已裁成 160×160 的 JPEG,这里再兜一层上限
        if len(avatar) > 400_000:
            raise ApiError(400, "头像图片太大了,请换一张小一点的")
    else:
        avatar = avatar[:4]
    x("UPDATE users SET nickname=?, avatar=? WHERE email=?", (nickname, avatar, email))
    return profile(email, role)


def roster():
    """社区端服务名单:所有选择过身份的用户,新用户登录后会自动出现在这里。"""
    admins = sorted(ADMIN_EMAILS)
    clause = ""
    args = ()
    if admins:
        clause = " AND email NOT IN (" + ",".join("?" * len(admins)) + ")"
        args = tuple(admins)
    rows = q(
        "SELECT email, role, nickname, avatar, created_at FROM users "
        "WHERE role IS NOT NULL" + clause + " ORDER BY created_at",
        args,
    )
    return {
        "users": [
            {
                "email": r["email"],
                "role": r["role"],
                "nickname": r["nickname"] or "",
                "avatar": r["avatar"] or "",
                "at": r["created_at"],
            }
            for r in rows
        ]
    }


# --------------------------------------------------------------------------- #
# 管理后台:仅 ADMIN_EMAILS 里的账号可用
# --------------------------------------------------------------------------- #
def require_admin(session, level="any"):
    """level="primary" 时只允许主管;默认主管和副管都可以。"""
    who = admin_level(session["email"])
    if not who:
        raise ApiError(403, "只有网站管理员可以进入管理后台")
    if level == "primary" and who != "primary":
        raise ApiError(403, "删除账号只能由主管操作")
    return who


def guard_admin_target(session, target):
    """管理员之间的操作边界:不能操作自己;副管不能动管理员;主管账号不可删除。"""
    if target == session["email"]:
        raise ApiError(400, "不能对自己执行这个操作")
    target_level = admin_level(target)
    if target_level and admin_level(session["email"]) != "primary":
        raise ApiError(403, "只有主管可以管理其他管理员")


def admin_users():
    rows = q(
        "SELECT u.email, u.role, u.nickname, u.avatar, u.created_at, "
        "(SELECT COUNT(*) FROM bindings b WHERE b.elder=u.email OR b.family=u.email) AS binds, "
        "(SELECT COUNT(*) FROM messages m WHERE m.from_email=u.email OR m.to_email=u.email) AS msgs "
        "FROM users u ORDER BY u.created_at DESC"
    )
    users = [
        {
            "email": r["email"],
            "role": r["role"],
            "nickname": r["nickname"] or "",
            "avatar": r["avatar"] or "",
            "at": r["created_at"],
            "bindings": r["binds"],
            "messages": r["msgs"],
            "adminLevel": admin_level(r["email"]),
        }
        for r in rows
    ]
    return {
        "users": users,
        "totals": {
            "all": len(users),
            "elders": len([u for u in users if u["role"] == "elder"]),
            "families": len([u for u in users if u["role"] == "family"]),
        },
    }


def admin_reset(email):
    """清空某人的资料与关联:下次登录会重新要求设置头像昵称,等同于“变回新用户”。"""
    if not get_user(email):
        raise ApiError(404, "没有这个用户")
    x("UPDATE users SET nickname=NULL, avatar=NULL WHERE email=?", (email,))
    x("DELETE FROM bindings WHERE elder=? OR family=?", (email, email))
    x("DELETE FROM messages WHERE from_email=? OR to_email=?", (email, email))
    x("DELETE FROM sessions WHERE email=?", (email,))
    x("DELETE FROM codes WHERE email=?", (email,))
    return {"ok": True, "email": email}


def admin_delete(email):
    admin_reset(email)
    x("DELETE FROM users WHERE email=?", (email,))
    return {"ok": True, "email": email}


def check_rate(email):
    now = time.time()
    with RATE_LOCK:
        stamps = [t for t in RATE.get(email, []) if now - t < 3600]
        if stamps and now - stamps[-1] < CODE_RESEND:
            raise ApiError(429, "发送太频繁,请 60 秒后再试")
        if len(stamps) >= CODE_HOURLY:
            raise ApiError(429, "1 小时内最多发送 5 次验证码")
        stamps.append(now)
        RATE[email] = stamps


def request_code(email):
    check_rate(email)
    ensure_user(email)
    code = f"{secrets.randbelow(900000) + 100000}"
    expires = time.time() + CODE_TTL
    x(
        "INSERT INTO codes (email, code, expires_at, attempts, sent_at) VALUES (?,?,?,0,?) "
        "ON CONFLICT(email) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at, "
        "attempts=0, sent_at=excluded.sent_at",
        (email, code, expires, time.time()),
    )
    try:
        send_code_mail(email, code)
    except Exception as exc:  # 邮件发不出去时,把失败原因返回给前端(不含凭据)
        print(f"[mail] 发送失败 {email}: {exc}", flush=True)
        raise ApiError(502, "验证码邮件发送失败,请稍后再试")
    return {"ok": True, "expiresIn": CODE_TTL}


def verify_code(email, code, role):
    if role not in ("elder", "family"):
        raise ApiError(400, "请先选择身份")
    code = str(code or "").strip()
    row = q("SELECT * FROM codes WHERE email=?", (email,))
    if not row:
        raise ApiError(400, "请先获取验证码")
    item = row[0]
    if item["expires_at"] < time.time():
        x("DELETE FROM codes WHERE email=?", (email,))
        raise ApiError(400, "验证码已过期,请重新获取")
    if item["attempts"] >= 5:
        raise ApiError(429, "尝试次数过多,请重新获取验证码")
    if not secrets.compare_digest(str(item["code"]), code):
        x("UPDATE codes SET attempts=attempts+1 WHERE email=?", (email,))
        raise ApiError(400, "验证码不正确")

    ensure_user(email)
    x("DELETE FROM codes WHERE email=?", (email,))
    x("UPDATE users SET role=? WHERE email=?", (role, email))
    token = secrets.token_urlsafe(32)
    x("INSERT INTO sessions (token, email, role, created_at) VALUES (?,?,?,?)", (token, email, role, time.time()))
    return {"token": token, **profile(email, role)}


def set_role(token, role):
    if role not in ("elder", "family"):
        raise ApiError(400, "身份只能是 elder 或 family")
    session = session_of(token)
    if not session:
        raise ApiError(401, "请先登录")
    x("UPDATE sessions SET role=? WHERE token=?", (role, token))
    x("UPDATE users SET role=? WHERE email=?", (role, session["email"]))
    return profile(session["email"], role)


def add_binding(email, role, other):
    if role not in ("elder", "family"):
        raise ApiError(400, "请先选择身份")
    # 允许 other == email:只有一个邮箱时的兜底方案
    if role == "elder":
        elder, family = email, other
    else:
        elder, family = other, email

    ensure_user(other)
    families, elders = bindings_of(email)
    if family in families or elder in elders:
        raise ApiError(409, "这个邮箱已经绑定过了")

    elder_count = q("SELECT COUNT(*) AS n FROM bindings WHERE elder=?", (elder,))[0]["n"]
    family_count = q("SELECT COUNT(*) AS n FROM bindings WHERE family=?", (family,))[0]["n"]
    if elder_count >= MAX_PER_SIDE:
        raise ApiError(400, f"这位老人最多绑定 {MAX_PER_SIDE} 位家属")
    if family_count >= MAX_PER_SIDE:
        raise ApiError(400, f"这个家属账号最多关联 {MAX_PER_SIDE} 位老人")

    x("INSERT INTO bindings (elder, family, created_at) VALUES (?,?,?)", (elder, family, time.time()))
    return profile(email, role)


def remove_binding(email, role, other):
    families, elders = bindings_of(email)
    if other in families:
        x("DELETE FROM bindings WHERE elder=? AND family=?", (email, other))
    elif other in elders:
        x("DELETE FROM bindings WHERE elder=? AND family=?", (other, email))
    else:
        raise ApiError(404, "没有这条绑定")
    return profile(email, role)


def send_message(email, to_email, body):
    body = str(body or "").strip()
    if not body:
        raise ApiError(400, "消息不能为空")
    if len(body) > 500:
        raise ApiError(400, "消息最多 500 字")
    families, _ = bindings_of(email)
    if to_email not in families:
        raise ApiError(403, "只能发给已绑定的家属邮箱")
    x(
        "INSERT INTO messages (from_email, to_email, body, created_at) VALUES (?,?,?,?)",
        (email, to_email, body, time.time()),
    )
    return {"ok": True}


def inbox(email):
    rows = q(
        "SELECT * FROM messages WHERE to_email=? OR from_email=? ORDER BY id DESC LIMIT 50",
        (email, email),
    )
    _, elders = bindings_of(email)
    return {
        "elders": elders,
        "messages": [
            {
                "id": r["id"],
                "from": r["from_email"],
                "to": r["to_email"],
                "body": r["body"],
                "at": r["created_at"],
                "mine": r["from_email"] == email,
            }
            for r in rows
        ],
    }


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
class Handler(SimpleHTTPRequestHandler):
    server_version = "YilianDemo/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE, **kwargs)

    # 演示环境统一禁止缓存,避免改了文件前端还拿旧版本
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            self.handle_api("GET")
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self.handle_api("POST")
        else:
            self.send_error(404)

    # -- helpers ---------------------------------------------------------- #
    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            raise ApiError(400, "请求格式不正确")

    def token(self):
        header = self.headers.get("Authorization") or ""
        return header[7:].strip() if header.startswith("Bearer ") else ""

    def require_session(self):
        session = session_of(self.token())
        if not session:
            raise ApiError(401, "请先登录")
        return session

    def require_user(self):
        return self.require_session()["email"]

    # -- routing ---------------------------------------------------------- #
    def handle_api(self, method):
        path = urlparse(self.path).path
        try:
            if method == "POST" and path == "/api/auth/request-code":
                data = self.read_json()
                result = request_code(normalise_email(data.get("email")))
            elif method == "POST" and path == "/api/auth/verify":
                data = self.read_json()
                result = verify_code(normalise_email(data.get("email")), data.get("code"), data.get("role"))
            elif method == "POST" and path == "/api/auth/logout":
                token = self.token()
                if token:
                    x("DELETE FROM sessions WHERE token=?", (token,))
                result = {"ok": True}
            elif method == "GET" and path == "/api/me":
                session = self.require_session()
                result = profile(session["email"], session["role"])
            elif method == "POST" and path == "/api/profile":
                data = self.read_json()
                session = self.require_session()
                result = set_profile(session["email"], session["role"], data.get("nickname"), data.get("avatar"))
            elif method == "GET" and path == "/api/public/roster":
                # 社区端是工作人员,不登录;名单只读,用于「服务对象」
                result = roster()
            elif method == "GET" and path == "/api/admin/users":
                session = self.require_session()
                require_admin(session)
                result = admin_users()
            elif method == "POST" and path == "/api/admin/reset":
                session = self.require_session()
                require_admin(session)
                target = normalise_email(self.read_json().get("email"))
                guard_admin_target(session, target)
                result = admin_reset(target)
            elif method == "POST" and path == "/api/admin/delete":
                session = self.require_session()
                require_admin(session, "primary")
                target = normalise_email(self.read_json().get("email"))
                guard_admin_target(session, target)
                if admin_level(target) == "primary":
                    raise ApiError(403, "主管账号不能删除")
                result = admin_delete(target)
            elif method == "POST" and path == "/api/role":
                data = self.read_json()
                result = set_role(self.token(), data.get("role"))
            elif method == "POST" and path == "/api/bind":
                data = self.read_json()
                session = self.require_session()
                result = add_binding(session["email"], session["role"], normalise_email(data.get("email")))
            elif method == "POST" and path == "/api/unbind":
                data = self.read_json()
                session = self.require_session()
                result = remove_binding(session["email"], session["role"], normalise_email(data.get("email")))
            elif method == "POST" and path == "/api/messages":
                data = self.read_json()
                result = send_message(
                    self.require_user(),
                    normalise_email(data.get("to")),
                    data.get("body"),
                )
            elif method == "GET" and path == "/api/messages":
                result = inbox(self.require_user())
            else:
                raise ApiError(404, "接口不存在")
            self.send_json(200, result)
        except ApiError as err:
            self.send_json(err.status, {"error": err.message})
        except Exception as err:  # 兜底,避免把堆栈返回给前端
            print(f"[api] {path} 出错: {err!r}")
            self.send_json(500, {"error": "服务器内部错误"})

    def log_message(self, fmt, *args):
        # 静态资源不刷屏,只记录接口
        if str(args[0]).startswith("4") or str(args[0]).startswith("5") or "/api/" in str(args[0]):
            super().log_message(fmt, *args)


def main():
    port = int(os.environ.get("PORT", "8000"))
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("image/svg+xml", ".svg")
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    print(f"颐联演示服务已启动: http://localhost:{port}/")
    print(f"数据库: {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
