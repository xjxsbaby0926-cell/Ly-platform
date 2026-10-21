/* 颐联 · 管理后台
   ---------------------------------------------------------------------------
   只有服务端 .env 里 ADMIN_EMAILS 列出的邮箱能进入。
   能力:
     · 查看全部账号(昵称/邮箱/角色/关联数/消息数/注册时间)
     · 「重置为新用户」:清空昵称、头像、关联、消息、会话 —— 下次登录重新设置资料
     · 「删除」:连账号一起删除
   凭据仍在服务端,这里只发请求。
   --------------------------------------------------------------------------- */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const token = () => { try { return localStorage.getItem('yl-token') || ''; } catch (e) { return ''; } };
  const esc = value => String(value == null ? '' : value).replace(/[&<>'"]/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]
  ));

  async function api(path, options) {
    const opts = options || {};
    const headers = {};
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (token()) headers.Authorization = 'Bearer ' + token();

    const response = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = {};
    try { data = await response.json(); } catch (e) {}
    if (!response.ok) throw new Error((data && data.error) || ('请求失败(' + response.status + ')'));
    return data;
  }

  const hint = message => { $('adminHint').textContent = message; };

  const showLogin = () => {
    $('loginPanel').hidden = false;
    $('adminPanel').hidden = true;
    $('adminWho').textContent = '未登录';
  };

  const fmtTime = seconds => {
    if (!seconds) return '—';
    const d = new Date(seconds * 1000);
    const pad = n => String(n).padStart(2, '0');
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };

  /* 二次确认:第一次点变成「再点一次确认」,3 秒内再点才执行 —— 避免误删 */
  function armed(button, run) {
    if (button.dataset.armed === '1') { run(); return; }
    button.dataset.armed = '1';
    const original = button.textContent;
    button.textContent = '再点一次确认';
    setTimeout(() => {
      if (button.dataset.armed === '1') { button.dataset.armed = '0'; button.textContent = original; }
    }, 3000);
  }

  function bindActions() {
    document.querySelectorAll('[data-reset]').forEach(button => {
      button.addEventListener('click', () => armed(button, async () => {
        const email = button.dataset.reset;
        try {
          await api('/api/admin/reset', { method: 'POST', body: { email } });
          hint('已重置为新用户：' + email);
          load();
        } catch (error) { hint(error.message); }
      }));
    });

    document.querySelectorAll('[data-delete]').forEach(button => {
      button.addEventListener('click', () => armed(button, async () => {
        const email = button.dataset.delete;
        try {
          await api('/api/admin/delete', { method: 'POST', body: { email } });
          hint('已删除：' + email);
          load();
        } catch (error) { hint(error.message); }
      }));
    });
  }

  async function load() {
    try {
      const me = await api('/api/me');
      if (!me.admin) throw new Error('这个邮箱不是网站管理员，无法进入管理后台');
      const data = await api('/api/admin/users');
      const isPrimary = me.adminLevel === 'primary';
      const label = me.adminLabel || '管理员';

      $('loginPanel').hidden = true;
      $('adminPanel').hidden = false;
      $('adminWho').textContent = me.email + ' · ' + label;
      const badge = $('adminRoleBadge');
      if (badge) badge.textContent = label + ' · 仅限授权邮箱';
      hint(isPrimary ? '' : '当前是副管账号：可以查看与重置用户，删除账号只能由主管操作。');

      const totals = data.totals;
      $('adminTotals').innerHTML = [
        ['全部账号', totals.all, '包含未设置昵称的用户'],
        ['老人', totals.elders, '老人端账号'],
        ['家属', totals.families, '家属端账号']
      ].map(item => '<div class="metric"><span>' + esc(item[0]) + '</span><b>' + item[1] + '</b><small>' + esc(item[2]) + '</small></div>').join('');

      $('adminList').innerHTML = data.users.length
        ? data.users.map(user => {
            const role = user.role === 'elder' ? '老人' : (user.role === 'family' ? '家属' : '未选身份');
            const level = user.adminLevel === 'primary' ? ' · <b class="admin-tag">主管</b>'
              : (user.adminLevel === 'secondary' ? ' · <b class="admin-tag">副管</b>' : '');
            // 边界与服务端一致:不能操作自己;副管不能动管理员;主管账号不可删除
            const targetIsSelf = user.email === me.email;
            const canReset = !targetIsSelf && (isPrimary || !user.adminLevel);
            const canDelete = isPrimary && !targetIsSelf && user.adminLevel !== 'primary';
            const actions = (canReset
              ? '<button type="button" class="soft-button" data-reset="' + esc(user.email) + '">重置为新用户</button>'
              : '') + (canDelete
              ? '<button type="button" class="outline-button" data-delete="' + esc(user.email) + '">删除</button>'
              : '');
            return '<li><div><strong>' + esc(user.nickname || user.email) + '</strong>' +
              '<span>' + esc(user.email) + ' · ' + role + ' · 关联 ' + user.bindings + ' · 消息 ' + user.messages + ' · ' + fmtTime(user.at) + level + '</span></div>' +
              '<div class="admin-actions">' + (actions || '<span class="muted">' + (targetIsSelf ? '当前账号' : '无操作权限') + '</span>') + '</div></li>';
          }).join('')
        : '<li class="empty">还没有用户</li>';

      bindActions();
    } catch (error) {
      hint(error.message);
      showLogin();
    }
  }

  $('adminSendCode').addEventListener('click', async () => {
    const mail = $('adminEmail').value.trim();
    if (!mail) { hint('请填写主管邮箱'); return; }
    hint('正在发送…');
    try {
      await api('/api/auth/request-code', { method: 'POST', body: { email: mail } });
      hint('验证码已发送，10 分钟内有效');
    } catch (error) { hint(error.message); }
  });

  $('adminLogin').addEventListener('click', async () => {
    const mail = $('adminEmail').value.trim();
    const code = $('adminCode').value.trim();
    if (!mail || !code) { hint('请填写邮箱和验证码'); return; }
    hint('正在登录…');
    try {
      const data = await api('/api/auth/verify', { method: 'POST', body: { email: mail, code, role: 'elder' } });
      localStorage.setItem('yl-token', data.token);
      if (!data.admin) { hint('这个邮箱不是网站管理员，无法进入管理后台'); return; }
      load();
    } catch (error) { hint(error.message); }
  });

  $('adminRefresh').addEventListener('click', load);

  if (token()) load();
  else showLogin();
})();
