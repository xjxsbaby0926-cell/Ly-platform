/* 颐联 · 邮箱登录 / 邮箱关联 / 站内消息(前端)
   ---------------------------------------------------------------------------
   凭据(smtplib 账号密码)只在服务端 server.py 的 .env 里,浏览器永远拿不到。
   浏览器只保存一个 session token(localStorage: yl-token)。

   入口页的流程:
     ① 首屏居中两个大入口「我是老人 / 我是家属」
     ② 选完 → 邮箱 + 验证码
     ③ 登录成功 → 直接进入对应角色页(不再停留在入口页)
     ④ 三个角色卡是第二步入口:点老人端/家属端会走同一套登录,社区端是工作人员,直接进

   规则(与服务端一致):
     · 老人邮箱最多绑定 5 位家属;家属邮箱最多关联 5 位老人;
     · 老人至少绑定 1 位家属,才能发送消息;
     · 只能给已绑定的邮箱发消息 —— 这就是“不会发错人”;
     · 只有一个邮箱时,可用「同一个邮箱」自绑定兜底。
   --------------------------------------------------------------------------- */
(function () {
  'use strict';

  const TOKEN_KEY = 'yl-token';
  const listeners = [];
  let profile = null;

  const esc = value => String(value == null ? '' : value).replace(/[&<>'"]/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]
  ));

  const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
  const writeToken = value => { try { value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} };
  const emit = () => listeners.forEach(fn => { try { fn(profile); } catch (e) {} });
  const rolePage = role => (role === 'family' ? './family/' : './elder/');

  async function api(path, options) {
    const opts = options || {};
    const headers = {};
    if (opts.body) headers['Content-Type'] = 'application/json';
    const token = readToken();
    if (token) headers.Authorization = 'Bearer ' + token;

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

  async function refresh() {
    if (!readToken()) { profile = null; emit(); return null; }
    try {
      profile = await api('/api/me');
      if (profile && !profile.role) { writeToken(''); profile = null; }
    } catch (error) {
      if (/请先登录|401/.test(error.message)) { writeToken(''); profile = null; }
    }
    emit();
    return profile;
  }

  const requestCode = email => api('/api/auth/request-code', { method: 'POST', body: { email } });

  async function verify(email, code, role) {
    const data = await api('/api/auth/verify', { method: 'POST', body: { email, code, role } });
    writeToken(data.token);
    delete data.token;
    profile = data;
    emit();
    return profile;
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    writeToken('');
    // 退出后回到未分区的演示数据
    if (window.YL && typeof YL.setScope === 'function') YL.setScope('');
    profile = null;
    emit();
  }

  async function setRole(role) { profile = await api('/api/role', { method: 'POST', body: { role } }); emit(); return profile; }
  async function bind(email) { profile = await api('/api/bind', { method: 'POST', body: { email } }); emit(); return profile; }
  async function unbind(email) { profile = await api('/api/unbind', { method: 'POST', body: { email } }); emit(); return profile; }
  const sendMessage = (to, body) => api('/api/messages', { method: 'POST', body: { to, body } });
  const inbox = () => api('/api/messages');
  const onChange = fn => { listeners.push(fn); if (profile) fn(profile); };

  /* ======================= 入口流程:登录 → 选端 → 邮箱验证码 ======================= */
  function initEntryFlow() {
    const grid = document.getElementById('roleGrid');
    const form = document.getElementById('roleLoginForm');
    const bindForm = document.getElementById('roleBindForm');
    if (!grid || !form || !bindForm) return;

    const title = document.getElementById('roleLoginTitle');
    const hint = document.getElementById('roleLoginHint');
    const emailInput = document.getElementById('roleEmail');
    const codeInput = document.getElementById('roleCode');
    const sendButton = document.getElementById('roleSendCode');
    const eyebrow = document.getElementById('rolesEyebrow');
    const roles = document.getElementById('roles');
    const bindTitle = document.getElementById('roleBindTitle');
    const bindHint = document.getElementById('roleBindHint');
    const bindInput = document.getElementById('roleBindEmail');

    let role = '';
    let countdown = 0;
    let timer = 0;

    const goRoles = () => roles.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const showRoles = () => {
      role = '';
      grid.hidden = false;
      form.hidden = true;
      bindForm.hidden = true;
      if (eyebrow) eyebrow.textContent = '选择一个入口';
      hint.textContent = '验证码 10 分钟内有效';
      sendButton.textContent = '发送验证码';
      sendButton.disabled = false;
      clearInterval(timer);
      countdown = 0;
    };

    const showLogin = picked => {
      role = picked;
      grid.hidden = true;
      form.hidden = false;
      bindForm.hidden = true;
      if (eyebrow) eyebrow.textContent = '登录';
      title.textContent = '以「' + (picked === 'elder' ? '老人' : '家属') + '」身份登录';
      hint.textContent = '验证码 10 分钟内有效';
      emailInput.focus();
    };

    /* 登录成功、但还没有绑定时:先绑定,再进入 */
    const showBind = picked => {
      role = picked;
      grid.hidden = true;
      form.hidden = true;
      bindForm.hidden = false;
      if (eyebrow) eyebrow.textContent = '关联邮箱';
      const isElder = picked === 'elder';
      bindTitle.textContent = isElder ? '绑定一位家属邮箱' : '绑定一位老人邮箱';
      bindHint.textContent = isElder
        ? '绑定后才能给家属发消息，也不会发错人。'
        : '绑定后才能收到老人的消息。';
      bindInput.placeholder = isElder ? '家属邮箱' : '老人邮箱';
      bindInput.value = '';
      bindInput.focus();
    };

    const enter = () => { location.href = rolePage(role); };

    document.getElementById('enterBtn')?.addEventListener('click', goRoles);
    document.querySelectorAll('[data-enter]').forEach(link => {
      link.addEventListener('click', event => { event.preventDefault(); goRoles(); });
    });
    document.getElementById('roleBack').addEventListener('click', showRoles);

    document.querySelectorAll('[data-role-entry]').forEach(card => {
      card.addEventListener('click', async event => {
        const target = card.dataset.roleEntry;
        // 社区端是工作人员,不需要邮箱登录,直接进
        if (target === 'community') return;

        event.preventDefault();
        // 已经登录过:直接按这个身份进入；还没绑定就先绑定
        if (profile && profile.email) {
          let p = profile;
          if (p.role !== target) {
            try { p = await setRole(target); }
            catch (error) { hint.textContent = error.message; return; }
          }
          const linked = target === 'elder' ? (p.families || []).length : (p.elders || []).length;
          if (!linked) { showBind(target); return; }
          location.href = card.getAttribute('href');
          return;
        }
        showLogin(target);
      });
    });

    sendButton.addEventListener('click', async () => {
      if (countdown > 0) return;
      const mail = emailInput.value.trim();
      if (!mail) { hint.textContent = '请先填写邮箱'; emailInput.focus(); return; }
      sendButton.disabled = true;
      hint.textContent = '正在发送…';
      try {
        await requestCode(mail);
        hint.textContent = '验证码已发送，10 分钟内有效';
        countdown = 60;
        clearInterval(timer);
        timer = setInterval(() => {
          countdown -= 1;
          if (countdown <= 0) {
            clearInterval(timer);
            sendButton.disabled = false;
            sendButton.textContent = '发送验证码';
            hint.textContent = '可以重新发送';
          } else {
            sendButton.textContent = countdown + 's';
          }
        }, 1000);
        codeInput.focus();
      } catch (error) {
        hint.textContent = error.message;
        sendButton.disabled = false;
      }
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!role) { showRoles(); return; }
      const mail = emailInput.value.trim();
      const value = codeInput.value.trim();
      if (!mail || !value) { hint.textContent = '请填写邮箱和验证码'; return; }
      hint.textContent = '正在登录…';
      try {
        const p = await verify(mail, value, role);
        const linked = role === 'elder' ? (p.families || []).length : (p.elders || []).length;
        if (linked > 0) { enter(); return; }
        showBind(role);
      } catch (error) {
        hint.textContent = error.message;
      }
    });

    bindForm.addEventListener('submit', async event => {
      event.preventDefault();
      const mail = bindInput.value.trim();
      if (!mail) { bindHint.textContent = '请填写邮箱'; return; }
      bindHint.textContent = '正在绑定…';
      try {
        await bind(mail);
        enter();
      } catch (error) {
        bindHint.textContent = error.message;
      }
    });

    document.getElementById('roleSelfBind').addEventListener('click', async () => {
      if (!profile) return;
      bindHint.textContent = '正在绑定…';
      try {
        await bind(profile.email);
        enter();
      } catch (error) {
        bindHint.textContent = error.message;
      }
    });

    document.getElementById('roleBindBack').addEventListener('click', async () => {
      await logout();
      showLogin(role);
    });
  }

  /* ======================= 登录之后:账户与关联 ======================= */
  function initAccount() {
    const dialog = document.getElementById('authDialog');
    const chip = document.getElementById('authChip');
    if (!dialog) return;
    const $ = id => document.getElementById(id);

    const render = p => {
      if (chip) {
        chip.hidden = !p;
        if (p) {
          chip.textContent = p.email.split('@')[0].slice(0, 14) + ' · 我的账户';
          chip.title = p.email;
        }
      }
      const stripLogout = document.getElementById('stripLogout');
      if (stripLogout) stripLogout.hidden = !p;
      if (!p) { if (dialog.open) dialog.close(); return; }

      $('authAccountEmail').textContent = p.email;
      document.querySelectorAll('[data-set-role]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.setRole === p.role);
      });

      const isElder = p.role === 'elder';
      const mine = isElder ? (p.families || []) : (p.elders || []);
      const hint = $('authBindHint');
      if (!p.role) hint.textContent = '先选择身份。';
      else if (isElder) hint.textContent = '已绑定 ' + mine.length + '/' + p.max + ' 位家属。至少 1 位，老人才可以发送消息。';
      else hint.textContent = '已关联 ' + mine.length + '/' + p.max + ' 位老人。至少 1 位，才能收到老人的消息。';

      const list = $('authBindingList');
      list.innerHTML = mine.length
        ? mine.map(mail => '<li><span>' + esc(mail) + '</span><button type="button" class="text-button" data-unbind="' + esc(mail) + '">解除</button></li>').join('')
        : '<li class="empty">还没有关联邮箱</li>';
      list.querySelectorAll('[data-unbind]').forEach(button => {
        button.addEventListener('click', async () => {
          try { await unbind(button.dataset.unbind); render(profile); }
          catch (error) { hint.textContent = error.message; }
        });
      });

      const form = $('authBindForm');
      form.hidden = !p.role;
      $('authBindEmail').placeholder = isElder ? '家属邮箱' : '老人邮箱';
      $('authBindEmail').disabled = mine.length >= p.max;
      form.querySelector('button').disabled = mine.length >= p.max;
      $('authSelfBind').hidden = !!p.selfBound || mine.length >= p.max;

      const adminLink = $('authAdminLink');
      if (adminLink) adminLink.hidden = !p.admin;
    };

    document.querySelectorAll('[data-close-auth]').forEach(button => {
      button.addEventListener('click', () => dialog.close());
    });

    chip?.addEventListener('click', () => {
      if (!profile) return;
      render(profile);
      dialog.showModal();
    });

    $('authLogout').addEventListener('click', async () => {
      await logout();
      render(null);
    });

    document.getElementById('stripLogout')?.addEventListener('click', async () => {
      await logout();
      render(null);
    });

    $('authEditProfile')?.addEventListener('click', openProfile);

    document.querySelectorAll('[data-set-role]').forEach(button => {
      button.addEventListener('click', async () => {
        try { await setRole(button.dataset.setRole); render(profile); }
        catch (error) { $('authBindHint').textContent = error.message; }
      });
    });

    $('authBindForm').addEventListener('submit', async event => {
      event.preventDefault();
      const input = $('authBindEmail');
      const mail = input.value.trim();
      if (!mail) return;
      try {
        await bind(mail);
        input.value = '';
        render(profile);
        $('authBindHint').textContent = '已添加关联';
      } catch (error) {
        $('authBindHint').textContent = error.message;
      }
    });

    $('authSelfBind').addEventListener('click', async () => {
      if (!profile) return;
      try {
        await bind(profile.email);
        render(profile);
        $('authBindHint').textContent = '已用同一个邮箱作为对方';
      } catch (error) {
        $('authBindHint').textContent = error.message;
      }
    });

    onChange(render);
  }

  /* ======================= 老人端:给家属发消息 ======================= */
  function initElderCard() {
    const card = document.getElementById('mailCard');
    if (!card) return;
    const badge = document.getElementById('mailBadge');
    const hint = document.getElementById('mailHint');
    const list = document.getElementById('mailList');
    const form = document.getElementById('mailForm');
    const to = document.getElementById('mailTo');
    const body = document.getElementById('mailBody');
    const toast = message => (window.YL && YL.toast ? YL.toast(message) : console.log(message));

    const render = p => {
      const families = (p && p.role === 'elder') ? (p.families || []) : [];

      if (!p) {
        badge.textContent = '未登录';
        hint.textContent = '请先在入口页用邮箱登录。登录并绑定家属邮箱后,才能从这里发消息。';
        list.innerHTML = '';
        form.hidden = true;
        return;
      }
      if (p.role !== 'elder') {
        badge.textContent = '家属账号';
        hint.textContent = '当前登录的是家属账号。请到家属端查看消息,或回入口页用老人身份登录。';
        list.innerHTML = '';
        form.hidden = true;
        return;
      }
      if (!families.length) {
        badge.textContent = '未绑定';
        hint.textContent = '还没有绑定家属邮箱。请回入口页,点右上角「我的账户」添加一位家属,绑定后才能发送,避免发错人。';
        list.innerHTML = '';
        form.hidden = true;
        return;
      }

      badge.textContent = families.length + ' / ' + p.max + ' 位家属';
      hint.textContent = '只能发给你已绑定的家属,不会发错人。';
      list.innerHTML = families.map(mail => '<li><span>' + esc(mail) + '</span><span class="readonly-badge">已绑定</span></li>').join('');
      to.innerHTML = families.map(mail => '<option value="' + esc(mail) + '">' + esc(mail) + '</option>').join('');
      form.hidden = false;
    };

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const text = body.value.trim();
      if (!text) return;
      try {
        await sendMessage(to.value, text);
        body.value = '';
        toast('已发送给 ' + to.value);
      } catch (error) {
        toast(error.message);
      }
    });

    onChange(render);
  }

  /* ======================= 家属端:收到老人的消息 ======================= */
  function initFamilyCard() {
    const card = document.getElementById('familyMailCard');
    if (!card) return;
    const badge = document.getElementById('familyMailBadge');
    const hint = document.getElementById('familyMailHint');
    const list = document.getElementById('familyMailList');

    const render = p => {
      if (!p) {
        badge.textContent = '未登录';
        hint.textContent = '请先在入口页用邮箱登录,并让老人把你加入「家属邮箱」。';
        list.innerHTML = '';
        return;
      }
      if (p.role !== 'family' || !(p.elders || []).length) {
        badge.textContent = p.role === 'family' ? '暂无关联老人' : '老人账号';
        hint.textContent = p.role === 'family'
          ? '还没有关联老人。请让老人在「我的账户 → 我的邮箱关联」里添加你的邮箱。'
          : '当前登录的是老人账号,请到老人端发送消息。';
        list.innerHTML = '';
        return;
      }
      badge.textContent = (p.elders || []).length + ' 位老人';
      hint.textContent = '下面是已绑定老人发来的消息。';
      inbox().then(data => {
        // 用“收件人是我”筛选,同一个邮箱兜底时收发方相同
        const rows = (data.messages || []).filter(m => m.to === p.email);
        list.innerHTML = rows.length
          ? rows.map(m => '<li><div><strong>' + esc(m.from) + '</strong><span>' + esc(m.body) + '</span></div></li>').join('')
          : '<li class="empty">暂时没有新消息</li>';
      }).catch(error => { list.innerHTML = '<li class="empty">' + esc(error.message) + '</li>'; });
    };

    onChange(render);
  }

  /* ======================= 首次登录:设置头像与昵称 ======================= */
  const AVATARS = ['颐', '家', '松', '兰', '竹', '福', '安', '春', '和', '宁'];
  let pickedAvatar = '';
  let profileShown = false;

  function profileDialog() {
    let dialog = document.getElementById('profileDialog');
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.id = 'profileDialog';
    dialog.className = 'auth-dialog';
    dialog.innerHTML = [
      '<div class="auth-body">',
      '  <div class="auth-head"><div><p class="section-kicker">第一次使用</p><h2>设置头像与昵称</h2></div>',
      '    <button type="button" class="close-button" data-close-profile aria-label="关闭">×</button></div>',
      '  <p class="auth-hint">别人会用这个昵称和头像看到你。之后可以在「我的账户」里重新设置。</p>',
      '  <div class="profile-avatars" id="profileAvatars">',
      AVATARS.map(a => '<button type="button" data-avatar="' + a + '">' + a + '</button>').join(''),
      '    <button type="button" class="profile-preview" id="profilePreviewBtn" hidden><img id="profilePreview" alt="" /></button>',
      '  </div>',
      '  <div class="profile-upload"><button type="button" class="soft-button" id="profileUploadBtn">上传图片…</button>',
      '    <span class="auth-hint">也可以用照片，自动裁成方形</span></div>',
      '  <input type="file" accept="image/*" id="profileFile" hidden />',
      '  <label class="form-field">昵称<input id="profileName" maxlength="20" placeholder="例如：周淑兰" /></label>',
      '  <p class="auth-hint" id="profileHint"></p>',
      '  <div class="dialog-actions"><button type="button" class="primary-button" id="profileSave">保存并进入</button></div>',
      '</div>'
    ].join('');
    document.body.appendChild(dialog);

    const previewButton = dialog.querySelector('#profilePreviewBtn');
    const previewImage = dialog.querySelector('#profilePreview');
    const fileInput = dialog.querySelector('#profileFile');

    const select = element => {
      dialog.querySelectorAll('[data-avatar], .profile-preview').forEach(item => {
        item.classList.toggle('is-active', item === element);
      });
    };

    dialog.querySelectorAll('[data-avatar]').forEach(button => {
      button.addEventListener('click', () => {
        pickedAvatar = button.dataset.avatar;
        select(button);
      });
    });

    previewButton.addEventListener('click', () => {
      if (previewImage.getAttribute('src')) { pickedAvatar = previewImage.getAttribute('src'); select(previewButton); }
    });

    dialog.querySelector('#profileUploadBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        const data = await toAvatar(file);
        previewImage.src = data;
        previewButton.hidden = false;
        pickedAvatar = data;
        select(previewButton);
      } catch (error) {
        dialog.querySelector('#profileHint').textContent = '图片读取失败，请换一张';
      }
    });
    dialog.querySelector('[data-close-profile]').addEventListener('click', () => dialog.close());
    dialog.querySelector('#profileSave').addEventListener('click', async () => {
      const name = dialog.querySelector('#profileName').value.trim();
      const hint = dialog.querySelector('#profileHint');
      if (!name) { hint.textContent = '请填写昵称'; return; }
      hint.textContent = '正在保存…';
      try {
        profile = await api('/api/profile', {
          method: 'POST',
          body: { nickname: name, avatar: pickedAvatar || name.slice(0, 1) }
        });
        emit();
        dialog.close();
      } catch (error) {
        hint.textContent = error.message;
      }
    });
    return dialog;
  }

  function openProfile() {
    const dialog = profileDialog();
    const name = dialog.querySelector('#profileName');
    const previewButton = dialog.querySelector('#profilePreviewBtn');
    const previewImage = dialog.querySelector('#profilePreview');
    name.value = profile ? (profile.nickname || '') : '';
    dialog.querySelector('#profileHint').textContent = '';

    const start = (profile && profile.avatar) || '';
    if (/^data:image\//.test(start)) {
      previewImage.src = start;
      previewButton.hidden = false;
      pickedAvatar = start;
      dialog.querySelectorAll('[data-avatar], .profile-preview').forEach(item => item.classList.toggle('is-active', item === previewButton));
    } else {
      const chip = dialog.querySelector('[data-avatar="' + (start || AVATARS[0]) + '"]') || dialog.querySelector('[data-avatar]');
      pickedAvatar = chip ? chip.dataset.avatar : AVATARS[0];
      dialog.querySelectorAll('[data-avatar], .profile-preview').forEach(item => item.classList.toggle('is-active', item === chip));
    }

    dialog.showModal();
    name.focus();
  }

  function maybeOpenProfile() {
    if (profileShown || !profile || profile.complete) return;
    // 只在老人端/家属端这类“角色内部页面”弹,入口页和管理后台不弹
    if (!document.getElementById('myName')) return;
    profileShown = true;
    setTimeout(openProfile, 400);
  }

  /* 把上传的图片裁成 160×160 的 JPEG data URL,避免把大图塞进数据库 */
  function toAvatar(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const size = 160;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const side = Math.min(image.width, image.height);
        ctx.drawImage(
          image,
          (image.width - side) / 2, (image.height - side) / 2, side, side,
          0, 0, size, size
        );
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
      image.src = url;
    });
  }

  /* 角色页守卫:未登录不展示内容;身份不符退回入口;右上角放「退出」 */
  function initRoleShell() {
    const pageRole = document.body.dataset.role || '';
    if (pageRole !== 'elder' && pageRole !== 'family') return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'display-button';
    button.id = 'logoutBtn';
    button.textContent = '退出';
    button.hidden = true;
    button.addEventListener('click', async () => {
      await logout();
      location.replace('../');
    });
    (document.querySelector('.top-actions') || document.querySelector('.topbar') || document.body).appendChild(button);

    let settled = false;
    onChange(p => {
      if (settled) return;
      settled = true;
      if (!p || p.role !== pageRole) { location.replace('../'); return; }
      button.hidden = false;
    });
  }

  /* 角色页的姓名/头像跟着登录用户走 */
  function paintIdentity(p) {
    if (!p) return;
    const name = p.nickname || p.email.split('@')[0];
    const avatar = p.avatar || name.slice(0, 1);
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const hasName = !!document.getElementById('myName');
    const avatarEl = document.getElementById('myAvatar');
    if (avatarEl) {
      if (/^data:image\//.test(avatar)) avatarEl.innerHTML = '<img src="' + avatar + '" alt="" />';
      else avatarEl.textContent = avatar;
    }
    set('myName', name);
    set('myGreeting', p.role === 'family' ? name + '的家庭协同' : '早上好，' + name);
    if (hasName && /^颐联/.test(document.title)) {
      document.title = document.title.replace(/·.*$/, '· ' + name);
    }
  }

  onChange(p => {
    if (!p) return;
    if (window.YL && typeof YL.setScope === 'function') YL.setScope(p.email);
    paintIdentity(p);
    maybeOpenProfile();
  });

  window.YL_AUTH = {
    get profile() { return profile; },
    refresh, requestCode, verify, logout, setRole, bind, unbind, sendMessage, inbox, onChange,
    openProfile
  };

  initEntryFlow();
  initAccount();
  initRoleShell();
  initElderCard();
  initFamilyCard();
  refresh();
})();
