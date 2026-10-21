const { escape, time, toast } = YL;
let activeRequestId = null;
let activeOwner = '';

// 家属看到的,是已绑定老人各自的数据(同浏览器内可直接读到)
function boundElders() {
  const auth = window.YL_AUTH && YL_AUTH.profile;
  return (auth && auth.role === 'family' && auth.elders) ? auth.elders : [];
}

function familyRequests() {
  const elders = boundElders();
  if (!elders.length) return YL.requests().filter(item => item.contactId === 'daughter').map(r => ({ ...r, _owner: '' })).reverse();
  const all = [];
  elders.forEach(mail => {
    YL.requestsOf(mail).forEach(r => { if (r.contactId === 'daughter') all.push({ ...r, _owner: mail }); });
  });
  all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return all.reverse();
}

// 家属端展示时的“主老人”(绑定多位时取第一位)与聚合后的共享事项
function primaryElder() {
  const elders = boundElders();
  return elders.length ? elders[0] : '';
}
function elderEscort() {
  const mail = primaryElder();
  return mail ? YL.escortOf(mail) : YL.escort();
}
function elderPermissions() {
  const mail = primaryElder();
  return mail ? YL.permissionsOf(mail) : YL.permissions();
}
function sharedEvents() {
  const permissionByType = { health: 0, life: 1, security: 2, social: 3 };
  const elders = boundElders();
  if (!elders.length) {
    const allowed = YL.permissions();
    return YL.events().filter(item => allowed[permissionByType[item.type]] === true);
  }
  return elders.flatMap(mail => {
    const allowed = YL.permissionsOf(mail);
    return YL.eventsOf(mail).filter(item => allowed[permissionByType[item.type]] === true);
  });
}

/* ---------- 待回复消息 ---------- */
function renderInbox() {
  const list = familyRequests();
  const pending = list.filter(x => !x.reply).length;
  document.querySelector('#pendingMetric').textContent = pending;
  document.querySelector('#pendingBadge').textContent = `${pending} 条待回复`;
  document.querySelector('#familyInbox').innerHTML = list.length
    ? list.map(r => `<article class="message-row ${r.reply ? '' : 'pending'}"><span class="person-avatar">周</span><div><strong>周阿姨 · ${escape(r.reason)}</strong><small>${r.message ? escape(r.message) : '没有补充说明'} · ${time(r.createdAt)}</small>${r.reply ? `<em>您已回复:${escape(r.reply)}</em>` : '<em>等待您的回复</em>'}</div><button class="${r.reply ? 'soft-button' : 'primary-button'}" data-reply-id="${r.id}">${r.reply ? '修改回复' : '立即回复'}</button></article>`).join('')
    : '<div class="empty">暂时没有老人发来的联系请求</div>';
  document.querySelector('#overviewInbox').innerHTML = list.slice(0, 2).map(r => `<article class="message-row ${r.reply ? '' : 'pending'}"><span class="person-avatar">周</span><div><strong>${escape(r.reason)}</strong><small>${r.message ? escape(r.message) : '没有补充说明'}</small></div><button class="soft-button" data-overview-message="messages">${r.reply ? '已回复' : '去回复'}</button></article>`).join('') || '<div class="empty">目前没有待处理的老人消息</div>';
  document.querySelectorAll('[data-reply-id]').forEach(b => b.addEventListener('click', () => openReply(Number(b.dataset.replyId))));
  document.querySelectorAll('[data-overview-message]').forEach(b => b.addEventListener('click', () => document.querySelector('[data-view="messages"]').click()));
}
function openReply(id) {
  const r = familyRequests().find(x => x.id === id);
  if (!r) return;
  activeRequestId = id;
  activeOwner = r._owner || '';
  document.querySelector('#incomingMessage').innerHTML = `<strong>周阿姨:${escape(r.reason)}</strong><br/>${r.message ? escape(r.message) : '没有补充说明'}`;
  document.querySelector('#replyText').value = r.reply || '';
  document.querySelector('#replyDialog').showModal();
}

/* ---------- 复诊出行:读老人端的确认结果 ---------- */
/* 家属只能看到状态,不能替老人确认——这正是页面上那句“不替老人完成确认”的落地方式。 */
function renderEscort() {
  const task = elderEscort();
  const confirmed = task.status === 'confirmed';
  const status = document.querySelector('#escortStatus');
  if (status) {
    status.textContent = confirmed ? '老人已确认' : '等待老人确认';
    status.classList.toggle('done', confirmed);
  }
  document.querySelector('#assistMetric').textContent = confirmed ? '0' : '1';
  document.querySelector('#assistNote').textContent = confirmed
    ? '复诊出行 · 老人已确认'
    : '复诊出行 · 等待老人确认';
}

/* ---------- 共享事项:按授权过滤 ---------- */
function renderEvents() {
  // 默认不放行:只有明确授权(true)的类型才展示。类型不在映射表里时
  // 过去用 `!== false` 判断会“失败即放行”,对隐私类产品是反的默认值。
  const items = sharedEvents();
  document.querySelector('#sharedEvents').innerHTML = items.map(item => `<article class="event-card"><div class="event-meta"><span>${item.icon} ${escape(item.label)}</span><span class="status ${item.state === 'done' ? 'done' : ''}">${escape(item.stateLabel)}</span></div><h3>${escape(item.title)}</h3><p>${escape(item.description)}</p><div class="event-owner"><span>${escape(item.owner)}</span><span class="readonly-badge">协助查看</span></div></article>`).join('') || '<div class="empty">老人暂未授权共享任何事项</div>';
}

/* ---------- 授权范围(只读) ---------- */
function renderPermissions() {
  const labels = [['复诊与用药事项', '可查看进度并协助安排'], ['生活服务进度', '可查看时间与完成状态'], ['数字安全核验', '高风险时参与复核'], ['社交与兴趣活动', '老人私人内容']];
  const values = elderPermissions();
  document.querySelector('#permissionView').innerHTML = labels.map((x, i) => `<div class="permission-row"><span><strong>${x[0]}</strong><small>${x[1]}</small></span><span class="readonly-badge">${values[i] ? '已授权' : '未授权'}</span></div>`).join('');
}

/* ---------- 协同记录 ---------- */
function renderTimeline() {
  const task = elderEscort();
  const escortEntry = task.status === 'confirmed'
    ? ['老人已确认复诊出行', `${YL.md(task.respondedAt)} · 社区陪诊员林芳按计划上门`]
    : ['提醒复诊陪诊安排', `${YL.md(YL.day(0))} · 已关注,等待老人本人确认`];
  const requests = familyRequests();
  const dynamic = requests.flatMap(r => [[`收到老人消息:${r.reason}`, time(r.createdAt)], ...(r.reply ? [[`回复周阿姨:${r.reply}`, time(r.repliedAt)]] : [])]);
  const base = [
    ['完成可疑短信核验', `${YL.md(YL.day(-2))} · 已提醒老人删除链接`],
    ['查看水龙头维修进度', `${YL.md(YL.day(-3))} · 服务人员已接单`]
  ];
  document.querySelector('#familyTimeline').innerHTML = [escortEntry, ...dynamic, ...base].map(x => `<div class="timeline-item"><strong>${escape(x[0])}</strong><span>${escape(x[1])}</span></div>`).join('');
}

/* 老人的安全核验记录:只有“数字安全核验”这项授权打开时才显示
   —— 与共享事项走同一套授权过滤,授权关掉后这里立即变空 */
function renderRiskLog() {
  const card = document.querySelector('#familyRiskCard');
  const box = document.querySelector('#familyRiskLog');
  if (!card || !box) return;
  if (YL.permissions()[2] !== true) { card.hidden = true; box.innerHTML = ''; return; }
  card.hidden = false;
  const list = YL.riskChecks();
  box.innerHTML = list.length ? list.slice(0, 6).map(item => {
    const level = YL_SAFETY.LEVELS[item.level] || YL_SAFETY.LEVELS.none;
    return `<li class="risk-log-item"><span class="risk-level ${item.level}">${escape(level.label)}</span><div><b>${escape(item.summary)}</b><small>${escape(item.by || '')} · ${time(item.at)}</small></div></li>`;
  }).join('') : '<li class="empty">老人还没有做过安全核验</li>';
}

YL.initShell();
renderEscort(); renderInbox(); renderEvents(); renderPermissions(); renderTimeline(); renderRiskLog();

document.querySelectorAll('[data-view-jump]').forEach(b => b.addEventListener('click', () => document.querySelector(`[data-view="${b.dataset.viewJump}"]`).click()));
document.querySelectorAll('[data-close-reply]').forEach(b => b.addEventListener('click', () => document.querySelector('#replyDialog').close()));
document.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => document.querySelector('#replyText').value = b.dataset.quick));
document.querySelector('#replyForm').addEventListener('submit', e => {
  e.preventDefault();
  try {
    const text = document.querySelector('#replyText').value;
    if (activeOwner) YL.replyRequestFor(activeOwner, activeRequestId, text);
    else YL.replyRequest(activeRequestId, text);
    document.querySelector('#replyDialog').close(); renderInbox(); renderTimeline();
    toast('回复已发送到周阿姨的老人端');
  } catch (error) { toast(error.message); }
});
document.querySelector('#assistBtn').addEventListener('click', e => {
  e.currentTarget.textContent = '我已关注';
  e.currentTarget.disabled = true;
  toast('已记录您的关注,出行方式仍由老人本人确认');
});
window.addEventListener('storage', () => { renderEscort(); renderInbox(); renderEvents(); renderPermissions(); renderTimeline(); renderRiskLog(); });

/* ---------- 可选的智能体工具(浏览器支持 WebMCP 时才生效) ---------- */
YL.registerTool({
  name: 'list_family_contact_requests',
  title: '查看家属待回复消息',
  description: '读取老人发送给当前家庭联系人的消息。',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  execute() { return { requests: familyRequests() }; }
});
YL.registerTool({
  name: 'reply_elder_contact_request',
  title: '回复老人消息',
  description: '以当前家庭联系人身份回复一条老人发来的联系请求。',
  inputSchema: { type: 'object', properties: { request_id: { type: 'number' }, reply: { type: 'string', minLength: 1, maxLength: 120 } }, required: ['request_id', 'reply'], additionalProperties: false },
  annotations: { readOnlyHint: false },
  execute(input) { const request = YL.replyRequest(input.request_id, input.reply); renderInbox(); renderTimeline(); return { id: request.id, status: request.status, replied_at: request.repliedAt }; }
});
