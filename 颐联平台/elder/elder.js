const { escape, time, toast } = YL;
let activeContact = null;

/* ---------- 今日最重要的事:复诊出行确认 ----------
   这件事的状态存在 yilian-escort 里,家属端与社区端读同一份数据。
   老人在这里点“确认社区陪诊”,另两端会立刻看到变化。 */
function renderEscort() {
  const task = YL.escort();
  const done = task.status === 'confirmed';
  document.querySelector('#escortTitle').textContent = task.title;
  document.querySelector('#escortPlace').textContent = task.place;
  document.querySelector('#escortNote').textContent = task.note;

  const status = document.querySelector('#escortStatus');
  status.textContent = done ? '已确认' : '等待确认';
  status.classList.toggle('done', done);

  const step = document.querySelector('#escortStep');
  step.textContent = done ? '✓ 出行确认' : '2 出行确认';
  step.classList.toggle('done', done);
  step.classList.toggle('current', !done);

  const button = document.querySelector('#confirmEscortBtn');
  button.disabled = done;
  button.textContent = done ? '已确认社区陪诊' : '确认社区陪诊';
}

/* ---------- 生活事项 ---------- */
function eventCard(item) { return `<article class="event-card"><div class="event-meta"><span>${item.icon} ${escape(item.label)}</span><span class="status ${item.state === 'done' ? 'done' : ''}">${escape(item.stateLabel)}</span></div><h3>${escape(item.title)}</h3><p>${escape(item.description)}</p><div class="event-owner"><span>${escape(item.owner)}</span><button class="text-button" data-event-id="${item.id}">${item.state === 'done' ? '查看记录' : '查看进度'}</button></div></article>`; }
function renderEvents() {
  const items = YL.events();
  document.querySelector('#homeEvents').innerHTML = items.slice(0, 3).map(eventCard).join('');
  document.querySelector('#allEvents').innerHTML = items.map(eventCard).join('');
  const counts = { attention: items.filter(x => x.state === 'attention').length, progress: items.filter(x => x.state === 'progress').length, done: items.filter(x => x.state === 'done').length };
  document.querySelector('#eventMetrics').innerHTML = `<div class="metric"><span>全部事项</span><b>${items.length}</b><small>由我发起和授权</small></div><div class="metric"><span>需要确认</span><b>${counts.attention}</b><small>建议今天处理</small></div><div class="metric"><span>处理中</span><b>${counts.progress}</b><small>已有人员承接</small></div><div class="metric"><span>已完成</span><b>${counts.done}</b><small>记录可以追溯</small></div>`;
}

/* ---------- 支持网络 ---------- */
function latestFor(id) { return YL.requests().filter(x => x.contactId === id).slice(-1)[0]; }
function renderContacts() {
  document.querySelector('#contactGrid').innerHTML = Object.entries(YL.contacts()).map(([id, c]) => {
    const latest = latestFor(id);
    return `<article class="contact-card"><span class="person-avatar">${escape(c.avatar)}</span><div><strong>${escape(c.name)}</strong><small>${escape(c.role)} · ${escape(c.note)}</small>${latest ? `<em>${latest.reply ? `${escape(c.name)}已回复:${escape(latest.reply)}` : `请求已发送:${escape(latest.reason)}`}</em>` : ''}</div><button class="soft-button" data-open-contact="${id}">${latest?.reply ? '查看对话' : '联系'}</button></article>`;
  }).join('');
  document.querySelectorAll('[data-open-contact]').forEach(button => button.addEventListener('click', () => openContact(button.dataset.openContact)));
}
function openContact(id) {
  activeContact = id; const c = YL.contacts()[id];
  if (!c) return;
  document.querySelector('#contactTitle').textContent = `联系${c.name}`;
  const rows = YL.requests().filter(x => x.contactId === id); const box = document.querySelector('#conversation');
  box.innerHTML = rows.length ? rows.flatMap(r => [`<div class="bubble"><b>我 · ${time(r.createdAt)}</b><span>${escape(r.reason)}${r.message ? `:${escape(r.message)}` : ''}</span></div>`, r.reply ? `<div class="bubble reply"><b>${escape(c.name)} · ${time(r.repliedAt)}</b><span>${escape(r.reply)}</span></div>` : '']).join('') : '<div class="empty">还没有联系记录</div>';
  document.querySelector('#contactMessage').value = ''; document.querySelector('#contactDialog').showModal();
}

/* ---------- 通知 ---------- */
function renderNotifications() {
  const replies = YL.requests().filter(x => x.reply).slice().reverse();
  document.querySelector('#notificationDot').hidden = !replies.length;
  document.querySelector('#notificationList').innerHTML = replies.length ? replies.map(r => `<article class="message-row"><span class="person-avatar">回</span><div><strong>${escape(r.name)}回复了您</strong><small>${escape(r.reply)} · ${time(r.repliedAt)}</small></div><button class="soft-button" data-notification-contact="${r.contactId}">查看对话</button></article>`).join('') : '<div class="empty">暂时没有新回复</div>';
  document.querySelectorAll('[data-notification-contact]').forEach(button => button.addEventListener('click', () => { document.querySelector('#notificationDialog').close(); openContact(button.dataset.notificationContact); }));
}

/* ---------- 首次渲染 ---------- */
document.querySelector('#todayDate').textContent = YL.todayLabel();
YL.initShell();
renderEscort(); renderEvents(); renderContacts(); renderNotifications();

document.querySelectorAll('[data-view-jump]').forEach(button => button.addEventListener('click', () => document.querySelector(`[data-view="${button.dataset.viewJump}"]`).click()));
document.querySelector('#confirmEscortBtn').addEventListener('click', () => {
  YL.confirmEscort('周淑兰');
  renderEscort();
  toast('已确认社区陪诊,家属端与社区端同步可见');
});
document.querySelector('#notificationBtn').addEventListener('click', () => { renderNotifications(); document.querySelector('#notificationDialog').showModal(); });
document.querySelectorAll('[data-close-notification]').forEach(b => b.addEventListener('click', () => document.querySelector('#notificationDialog').close()));
document.querySelectorAll('[data-close-contact]').forEach(b => b.addEventListener('click', () => document.querySelector('#contactDialog').close()));
document.querySelector('#contactForm').addEventListener('submit', e => {
  e.preventDefault();
  try {
    const request = YL.sendRequest(activeContact, document.querySelector('#contactReason').value, document.querySelector('#contactMessage').value);
    document.querySelector('#contactDialog').close(); renderContacts();
    toast(`已向${request.name}发送联系请求`);
  } catch (error) { toast(error.message); }
});

/* ---------- 共享授权 ---------- */
const saved = YL.permissions();
document.querySelectorAll('[data-permission]').forEach((input, i) => { input.checked = Boolean(saved[i]); });
document.querySelector('#savePermissionsBtn').addEventListener('click', () => {
  YL.savePermissions([...document.querySelectorAll('[data-permission]')].map(x => x.checked));
  toast('共享范围已按您的选择保存');
});

/* ---------- 新建生活事项 ---------- */
document.querySelector('#addEventBtn').addEventListener('click', () => document.querySelector('#eventDialog').showModal());
document.querySelectorAll('[data-close-event]').forEach(b => b.addEventListener('click', () => document.querySelector('#eventDialog').close()));
document.querySelector('#eventForm').addEventListener('submit', e => {
  e.preventDefault();
  const type = document.querySelector('#eventType').value;
  const map = { health: ['医', '健康事务'], life: ['助', '生活服务'], security: ['安', '数字安全'], social: ['伴', '社交活动'] };
  const items = YL.events();
  items.unshift({
    id: Date.now(), type, icon: map[type][0], label: map[type][1],
    title: document.querySelector('#eventTitle').value,
    description: document.querySelector('#eventDescription').value || '等待平台匹配合适的支持者。',
    state: 'attention', stateLabel: '需确认', owner: '等待承接'
  });
  YL.saveEvents(items);
  document.querySelector('#eventDialog').close(); e.currentTarget.reset(); renderEvents();
  toast('生活事项已创建');
});

/* ---------- 安全核验 ---------- */
document.querySelector('#analyzeBtn').addEventListener('click', () => {
  const text = document.querySelector('#safetyText').value.trim();
  if (!text) { toast('请先输入需要核验的内容'); return; }
  const hits = [/验证码|密码|银行卡/, /转账|汇款|安全账户/, /立即|马上|逾期/, /链接|下载|安装/].filter(x => x.test(text)).length;
  document.querySelector('#safetyResult').innerHTML = hits
    ? `<div class="risk-result"><strong>发现 ${hits} 类风险话术</strong><p>请不要点击链接、提供验证码或进行转账。建议通过官方公开电话核验,并联系家属共同确认。</p></div>`
    : '<div class="empty"><strong>暂未发现明显风险话术</strong><br/>涉及资金和账户信息时仍应独立核验。</div>';
  toast('安全核验已完成');
});

/* 另一标签页改动了数据时同步刷新(storage 事件只在其他文档触发) */
window.addEventListener('storage', () => { renderEscort(); renderEvents(); renderContacts(); renderNotifications(); });

/* ---------- 可选的智能体工具(浏览器支持 WebMCP 时才生效) ---------- */
YL.registerTool({
  name: 'list_my_life_events',
  title: '查看我的生活事项',
  description: '读取老人本人当前可见的生活事项。',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  execute() { return { events: YL.events() }; }
});
YL.registerTool({
  name: 'confirm_my_escort',
  title: '确认社区陪诊',
  description: '以老人本人身份确认明日复诊的社区陪诊安排。',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: false },
  execute() { const task = YL.confirmEscort('周淑兰'); renderEscort(); return { status: task.status, respondedAt: task.respondedAt }; }
});
YL.registerTool({
  name: 'send_my_contact_request',
  title: '联系我的支持者',
  description: '以老人本人身份向已登记的家属、社区专员或服务者发送联系请求。',
  inputSchema: { type: 'object', properties: { contact_id: { type: 'string', enum: ['daughter', 'community', 'repair'] }, reason: { type: 'string', minLength: 1, maxLength: 30 }, message: { type: 'string', maxLength: 100 } }, required: ['contact_id', 'reason'], additionalProperties: false },
  annotations: { readOnlyHint: false },
  execute(input) { const request = YL.sendRequest(input.contact_id, input.reason, input.message || ''); renderContacts(); return { id: request.id, status: request.status }; }
});
