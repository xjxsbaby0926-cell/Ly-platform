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

/* ---------- 安全核验 ----------
   识别逻辑在 safety.js(纯本地规则),这里只负责把结果讲清楚:
   风险等级 + 命中了哪几类话术 + 具体命中词 + 链接/号码分析 + 该怎么做。 */
function renderRisk(result) {
  const serious = result.level === 'high' || result.level === 'medium';
  const actions = serious
    ? '<div class="risk-actions"><b>拿不准?让家人一起看</b><div class="quick-row"><button type="button" data-risk-share="daughter">发给女儿帮我看</button><button type="button" data-risk-share="community">发给社区专员</button></div></div>'
    : '';
  // 报告结构由 safety.js 统一生成(三端一致),这里只补上老人端特有的操作区
  return YL_SAFETY.renderReport(result, { allowTrust: true, actions });
}

/* 一键把“内容 + 结论”发给家属或社区专员,复用已有的联系请求通道。
   这样风控结果会进入三端协同,而不是停在老人自己的屏幕上。 */
function bindRiskShare(result) {
  document.querySelectorAll('[data-risk-share]').forEach(button => {
    button.addEventListener('click', () => {
      const contactId = button.dataset.riskShare;
      const person = YL.contacts()[contactId];
      const reason = '我收到一条可疑信息,请帮我确认';
      const summary = `风险:${YL_SAFETY.LEVELS[result.level].label};内容:${String(result.raw).replace(/\s+/g, ' ').slice(0, 60)}`;
      try {
        YL.sendRequest(contactId, reason, summary);
        renderContacts();
        button.disabled = true;
        button.textContent = `已发给${person.name}`;
        toast(`已把这条内容和结论发给${person.name}`);
      } catch (error) { toast(error.message); }
    });
  });
}

/* 允许老人把某个号码标成“可信”(家人、社区、官方号码),下次核验就不再标记它。
   这是“发信人是谁”的轻量实现——真实系统里应由服务端下发号码归属。 */
function bindTrustButtons() {
  document.querySelectorAll('[data-trust-number]').forEach(button => {
    button.addEventListener('click', () => {
      const number = button.dataset.trustNumber;
      YL.addTrustedNumber(number);
      toast(`已把 ${number} 加入可信名单,以后再收到它不会被标记`);
      const text = document.querySelector('#safetyText').value.trim();
      if (text) runRiskCheck(text);
    });
  });
}

/* 核验记录:让“风控”这一步也留痕,家属和社区在授权范围内能看到 */
function renderRiskLog() {
  const box = document.querySelector('#riskLog');
  if (!box) return;
  const list = YL.riskChecks();
  box.innerHTML = list.length ? list.slice(0, 8).map(item => {
    const level = YL_SAFETY.LEVELS[item.level] || YL_SAFETY.LEVELS.none;
    return `<li class="risk-log-item"><span class="risk-level ${item.level}">${escape(level.label)}</span><div><b>${escape(item.summary)}</b><small>${escape(item.by || '')} · ${time(item.at)}</small></div></li>`;
  }).join('') : '<li class="empty">还没有核验记录</li>';
}

function runRiskCheck(text) {
  const trusted = { numbers: YL.trustedNumbers(), domains: YL.trustedDomains() };
  const result = YL_SAFETY.check(text, trusted);
  YL.addRiskCheck({
    id: Date.now(),
    at: new Date().toISOString(),
    by: '周淑兰',
    level: result.level,
    score: result.score,
    summary: String(text).replace(/\s+/g, ' ').slice(0, 60)
  });
  document.querySelector('#safetyResult').innerHTML = renderRisk(result);
  bindRiskShare(result);
  bindTrustButtons();
  renderRiskLog();
  toast(`核验完成:${YL_SAFETY.LEVELS[result.level].short}`);
}

document.querySelector('#analyzeBtn').addEventListener('click', () => {
  const text = document.querySelector('#safetyText').value.trim();
  if (!text) { toast('请先输入需要核验的内容'); return; }
  runRiskCheck(text);
});
renderRiskLog();
// 一键填入典型话术,方便快速验证识别范围
const sampleBox = document.querySelector('#safetySamples');
if (sampleBox) {
  sampleBox.innerHTML = YL_SAFETY.SAMPLES.map((item, i) => `<button type="button" data-sample="${i}">${escape(item.label)}</button>`).join('');
  sampleBox.querySelectorAll('[data-sample]').forEach(button => button.addEventListener('click', () => {
    document.querySelector('#safetyText').value = YL_SAFETY.SAMPLES[Number(button.dataset.sample)].text;
    document.querySelector('#analyzeBtn').click();
  }));
}

/* 另一标签页改动了数据时同步刷新(storage 事件只在其他文档触发) */
window.addEventListener('storage', () => { renderEscort(); renderEvents(); renderContacts(); renderNotifications(); renderRiskLog(); });

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
