const { escape, toast } = YL;

/* 数据来自 seed.js,运行时被复制进 localStorage —— 承接结果、调度规则都会写回,刷新不丢。 */
const staffMembers = () => YL.staff();
const queue = () => YL.queue();
const rulesState = () => YL.rules();

let sortMode = 'risk';
let activeCaseId = null;
let currentStaffId = YL.read(YL.KEYS.communityStaff, 'lin');
if (!staffMembers().some(person => person.id === currentStaffId)) currentStaffId = 'lin';

const currentStaff = () => staffMembers().find(person => person.id === currentStaffId) || staffMembers()[0];
const staffName = id => staffMembers().find(person => person.id === id)?.name || '待分派';

/* 一条事项当前该显示什么状态:
   已被承接 → 显示承接人;复诊那条 → 跟着老人端的确认结果走;
   其余 → 用种子里的业务状态(备件中/配送中/核验中……)。 */
function caseStatus(item) {
  if (item.claimedBy) return `${item.claimedBy} 已承接`;
  if (item.escortLinked) return YL.escort().status === 'confirmed' ? '老人已确认' : '待老人确认';
  return item.status;
}

/* ---------- 指标:全部从协同队列实时算出,不再写死 ---------- */
function metricsFor(person) {
  const owned = queue().filter(item => item.owner === person.id);
  return [
    ['我的待办', owned.length, '名下协同事项'],
    ['高优先', owned.filter(i => i.urgent).length, '需要优先处理'],
    ['处理中', owned.filter(i => i.phase === 'active').length, '已有人员在场'],
    ['待确认', owned.filter(i => i.phase === 'pending').length, '等待确认或出发']
  ];
}
function metricHtml(metrics) {
  return metrics.map(item => `<div class="metric"><span>${escape(item[0])}</span><b>${escape(item[1])}</b><small>${escape(item[2])}</small></div>`).join('');
}

/* 业务线的能力上限:从任意一位声明了该业务线的人员身上取,避免写死第二份配置 */
function trackCapacity(track) {
  for (const person of staffMembers()) {
    const hit = person.tracks.find(([name]) => name === track);
    if (hit) return hit[1];
  }
  return 5;
}
/* 服务负荷:分子 = 该业务线名下的事项数,分母 = 能力上限。
   除了本人负责的业务线,还会把“跨线接过来的事项”一并显示出来。 */
function loadFor(person) {
  const owned = queue().filter(item => item.owner === person.id);
  const names = [...new Set([...person.tracks.map(([name]) => name), ...owned.map(item => item.track)])];
  return names.map(track => {
    const cap = trackCapacity(track);
    const used = owned.filter(item => item.track === track).length;
    return [track, Math.min(100, Math.round(used / cap * 100)), `${used} / ${cap}`];
  });
}
function capacityHtml(items) {
  return items.map(item => `<div class="capacity-row"><span>${escape(item[0])}</span><div class="capacity-bar"><i style="width:${item[1]}%"></i></div><b>${escape(item[2])}</b></div>`).join('');
}

/* 团队视角:整条队列按状态分布 */
function teamBreakdown() {
  const all = queue();
  const total = all.length || 1;
  return [
    ['高优先', Math.round(all.filter(i => i.urgent).length / total * 100), `${all.filter(i => i.urgent).length} 项`],
    ['处理中', Math.round(all.filter(i => i.phase === 'active').length / total * 100), `${all.filter(i => i.phase === 'active').length} 项`],
    ['待确认', Math.round(all.filter(i => i.phase === 'pending').length / total * 100), `${all.filter(i => i.phase === 'pending').length} 项`],
    ['已承接', Math.round(all.filter(i => i.claimedBy).length / total * 100), `${all.filter(i => i.claimedBy).length} 项`]
  ];
}

function queueHtml(items) {
  if (!items.length) return '<div class="empty">当前没有待处理事项,可以支援团队队列。</div>';
  return items.map(item => `<article class="queue-row ${item.urgent && !item.claimedBy ? 'urgent' : ''}"><span class="status">${escape(item.deadline)}</span><div><strong>${escape(item.title)}</strong><small>${escape(item.description)} · ${escape(caseStatus(item))} · 承接:${escape(staffName(item.owner))}</small></div><button class="soft-button" data-case-id="${item.id}">${item.urgent ? '立即处理' : '查看事项'}</button></article>`).join('');
}
function bindCaseButtons() {
  document.querySelectorAll('[data-case-id]').forEach(button => button.addEventListener('click', () => openCase(button.dataset.caseId)));
}

function renderQueue() {
  const sorter = (a, b) => sortMode === 'risk' ? b.risk - a.risk || a.time - b.time : a.time - b.time;
  const personal = queue().filter(item => item.owner === currentStaffId).sort(sorter);
  document.querySelector('#priorityQueue').innerHTML = queueHtml(personal.slice(0, 3));
  document.querySelector('#fullQueue').innerHTML = queueHtml([...queue()].sort(sorter));
  document.querySelector('#personalQueueTitle').textContent = `${currentStaff().name}的今日待办`;
  bindCaseButtons();
}

function renderResources() {
  const staff = currentStaff();
  document.querySelector('#capacitySummary').innerHTML = capacityHtml(loadFor(staff));
  document.querySelector('#capacityFull').innerHTML = capacityHtml(teamBreakdown());
  document.querySelector('#workers').innerHTML = staffMembers().map(person => `<article class="contact-card staff-card ${person.id === currentStaffId ? 'current-staff' : ''}"><span class="person-avatar">${escape(person.avatar)}</span><div><strong>${escape(person.name)} · ${escape(person.specialty)}</strong><small>${escape(person.role)} · ${escape(person.shift)} · ${escape(person.area)}</small></div><span class="readonly-badge">${person.id === currentStaffId ? '当前登录' : escape(person.availability)}</span></article>`).join('');
}

function renderRules() {
  const values = rulesState();
  document.querySelectorAll('[data-rule]').forEach((input, i) => { input.checked = Boolean(values[i]); });
}

function renderProfile() {
  const staff = currentStaff();
  document.querySelector('#staffAvatar').textContent = staff.avatar;
  document.querySelector('#staffRole').textContent = `${staff.role} · ${staff.specialty}`;
  document.querySelector('#staffSpecialtyBadge').textContent = staff.specialty;
  document.querySelector('#communityEyebrow').textContent = `春和社区服务站 · ${staff.shift} · ${staff.area}`;
  document.querySelector('#communityTitle').textContent = `${staff.name}的协同工作台`;
  document.querySelector('#availabilityStatus').textContent = staff.availability;
  document.querySelector('#workbenchMetrics').innerHTML = metricHtml(metricsFor(staff));
  document.title = `颐联社区端 · ${staff.name}`;
}

function renderAll() {
  renderProfile();
  renderQueue();
  renderResources();
  renderRules();
}

function openCase(id) {
  const item = queue().find(entry => entry.id === id);
  if (!item) return;
  activeCaseId = id;
  const staff = currentStaff();
  document.querySelector('#caseTitle').textContent = item.title;
  document.querySelector('#caseDescription').textContent = `${item.description}。当前时限:${item.deadline}。当前状态:${caseStatus(item)}。承接人:${staffName(item.owner)}。`;
  const claimButton = document.querySelector('#claimCaseBtn');
  claimButton.hidden = item.owner === currentStaffId && Boolean(item.claimedBy);
  claimButton.textContent = item.owner === currentStaffId ? `确认由${staff.name}承接` : `转由${staff.name}承接`;
  document.querySelector('#caseDialog').showModal();
}

const staffSelect = document.querySelector('#staffSelect');
staffSelect.innerHTML = staffMembers().map(person => `<option value="${person.id}">${escape(person.name)}</option>`).join('');
staffSelect.value = currentStaffId;

YL.initShell();
renderAll();

/* ---------- 服务对象名单:老人端/家属端每登录一个人,这里就多一个名字 ---------- */
function renderRoster() {
  const list = document.getElementById('rosterList');
  const count = document.getElementById('rosterCount');
  if (!list) return;
  fetch('/api/public/roster')
    .then(response => response.json())
    .then(data => {
      const users = (data.users || []).filter(item => item.nickname || item.role);
      if (count) count.textContent = users.length + ' 人';
      list.innerHTML = users.length
        ? users.map(item => '<li><div><strong>' + escape(item.nickname || item.email) + '</strong><span>' + escape(item.email) + '</span></div><span class="readonly-badge">' + (item.role === 'elder' ? '老人' : '家属') + '</span></li>').join('')
        : '<li class="empty">还没有用户登录</li>';
    })
    .catch(() => { list.innerHTML = '<li class="empty">名单加载失败</li>'; });
}
renderRoster();
document.querySelector('[data-view="resources"]').addEventListener('click', renderRoster);

staffSelect.addEventListener('change', event => {
  currentStaffId = event.target.value;
  YL.write(YL.KEYS.communityStaff, currentStaffId);
  document.querySelector('[data-view="workbench"]').click();
  renderAll();
  toast(`已登录${currentStaff().name}的独立工作台`);
});

document.querySelectorAll('[data-view-jump]').forEach(button => button.addEventListener('click', () => document.querySelector(`[data-view="${button.dataset.viewJump}"]`).click()));
document.querySelector('#sortQueueBtn').addEventListener('click', event => {
  sortMode = sortMode === 'risk' ? 'time' : 'risk';
  event.currentTarget.textContent = sortMode === 'risk' ? '当前:风险优先' : '当前:时限优先';
  renderQueue();
  toast('协同队列已重新排序');
});
document.querySelectorAll('[data-close-case]').forEach(button => button.addEventListener('click', () => document.querySelector('#caseDialog').close()));

document.querySelector('#claimCaseBtn').addEventListener('click', () => {
  const list = queue();
  const item = list.find(entry => entry.id === activeCaseId);
  if (!item) return;
  const staff = currentStaff();
  item.owner = staff.id;
  item.claimedBy = staff.name;
  if (item.phase === 'pending') item.phase = 'active';
  YL.saveQueue(list);
  document.querySelector('#caseDialog').close();
  renderAll();
  toast(`事项已由${staff.name}承接,指标与负荷已同步更新`);
});

document.querySelector('#saveRulesBtn').addEventListener('click', () => {
  YL.saveRules([...document.querySelectorAll('[data-rule]')].map(input => input.checked));
  toast('社区调度规则已保存');
});

/* ---------- 数字安全专员:协助居民核验可疑信息 ---------- */
function runCommunityCheck() {
  const text = document.querySelector('#communitySafetyText').value.trim();
  if (!text) { toast('请先粘贴需要核验的内容'); return; }
  const trusted = { numbers: YL.trustedNumbers(), domains: YL.trustedDomains() };
  const result = YL_SAFETY.check(text, trusted);
  const serious = result.level === 'high' || result.level === 'medium';
  const actions = serious
    ? '<div class="risk-actions"><b>需要跟进吗?</b><div class="quick-row"><button type="button" data-risk-case>生成协同事项</button></div></div>'
    : '';
  document.querySelector('#communitySafetyResult').innerHTML = YL_SAFETY.renderReport(result, { actions });
  const caseButton = document.querySelector('[data-risk-case]');
  if (caseButton) caseButton.addEventListener('click', () => createRiskCase(result, text));
  toast(`核验完成:${YL_SAFETY.LEVELS[result.level].short}`);
}

/* 高风险核验直接落成一条协同事项进入队列 —— 风控在这里和调度闭环 */
function createRiskCase(result, text) {
  const list = queue();
  const staff = currentStaff();
  list.push({
    id: 'q' + Date.now(),
    owner: staff.id,
    risk: result.level === 'high' ? 3 : 2,
    time: 120,
    urgent: result.level === 'high',
    phase: 'pending',
    track: '诈骗核验',
    status: '待跟进',
    claimedBy: staff.name,
    title: '可疑信息核验 · 待跟进',
    description: `风险:${YL_SAFETY.LEVELS[result.level].label};内容:${String(text).replace(/\s+/g, ' ').slice(0, 40)}`,
    deadline: '今天内'
  });
  YL.saveQueue(list);
  renderAll();
  const button = document.querySelector('[data-risk-case]');
  if (button) { button.disabled = true; button.textContent = '已生成协同事项'; }
  toast('已生成协同事项,可在「协同队列」查看跟进');
}

document.querySelector('#communityAnalyzeBtn').addEventListener('click', runCommunityCheck);

/* 另一标签页(例如老人端确认了陪诊)改动数据时同步刷新 */
window.addEventListener('storage', () => { renderAll(); });

/* ---------- 可选的智能体工具(浏览器支持 WebMCP 时才生效) ---------- */
YL.registerTool({
  name: 'list_community_service_queue',
  title: '查看社区服务队列',
  description: '读取当前登录社区服务人员的待处理事项,不包含家庭私聊。',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  execute() { return { current_staff: currentStaff(), queue: queue().filter(item => item.owner === currentStaffId) }; }
});
YL.registerTool({
  name: 'claim_community_case',
  title: '承接社区服务事项',
  description: '由当前登录的社区服务人员承接指定事项。',
  inputSchema: { type: 'object', properties: { case_id: { type: 'string' } }, required: ['case_id'], additionalProperties: false },
  annotations: { readOnlyHint: false },
  execute(input) {
    const list = queue();
    const item = list.find(entry => entry.id === input.case_id);
    if (!item) throw new Error('未找到社区服务事项');
    item.owner = currentStaffId;
    item.claimedBy = currentStaff().name;
    if (item.phase === 'pending') item.phase = 'active';
    YL.saveQueue(list);
    renderAll();
    return { id: item.id, status: caseStatus(item), owner: currentStaff().name };
  }
});
