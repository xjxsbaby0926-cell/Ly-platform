/* 颐联 · 三端共用的工具层
   ⚠️ 这是一个纯静态演示页面:没有后端、没有接口、没有真实鉴权。
   所有数据都存在当前浏览器(同源)的 localStorage 里,页面之间靠 storage 事件同步。
   因此“共享授权”只是界面约定,不是真实的数据隔离——详见 README.md。

   localStorage 键:
     yilian-events             老人端的生活事项
     yilian-contact-requests   老人发出的联系请求及回复
     yilian-permissions        老人端的共享授权开关
     yilian-escort             “确认社区陪诊”这件事的状态(三端共读)
     yilian-community-queue    社区端协同队列(承接结果会写回这里)
     yilian-community-rules    社区端调度规则开关
     yilian-large-text         大字模式
     ylCommunityStaff          社区端当前登录的服务人员
*/
(function () {
  'use strict';

  const SEED = window.YL_SEED || {};

  const KEYS = {
    events: 'yilian-events',
    requests: 'yilian-contact-requests',
    permissions: 'yilian-permissions',
    escort: 'yilian-escort',
    queue: 'yilian-community-queue',
    rules: 'yilian-community-rules',
    riskChecks: 'yilian-risk-checks',
    trustedNumbers: 'yilian-trusted-numbers',
    trustedDomains: 'yilian-trusted-domains',
    largeText: 'yilian-large-text',
    communityStaff: 'ylCommunityStaff'
  };
  const ALL_KEYS = Object.keys(KEYS).map(k => KEYS[k]);

  /* ---- 数据分区 ----
     每个登录邮箱一份自己的数据:键名追加 ":邮箱"。
     未登录时保持原来的键(演示数据),登录后各人互不影响。
     社区端的队列/规则属于服务站,不分区。 */
  const SCOPE_KEY = 'yl-scope';
  let scope = '';
  try { scope = localStorage.getItem(SCOPE_KEY) || ''; } catch (e) { scope = ''; }
  const scoped = name => (scope ? name + ':' + scope : name);
  const setScope = email => {
    scope = email || '';
    try { scope ? localStorage.setItem(SCOPE_KEY, scope) : localStorage.removeItem(SCOPE_KEY); } catch (e) {}
  };

  const read = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (error) { console.warn('[颐联] 本地存储写入失败(可能是隐私模式或空间不足)', key, error); return false; }
  };

  const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const time = value => value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '刚刚';

  // ---- 日期:页面上不再写死“9月28日”这类字面量 ----
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  const day = offset => { const d = new Date(); d.setDate(d.getDate() + (offset || 0)); return d; };
  const md = value => { const d = value ? new Date(value) : new Date(); return `${d.getMonth() + 1}月${d.getDate()}日`; };
  const todayLabel = () => { const d = new Date(); return `${md(d)} · 星期${WEEKDAYS[d.getDay()]}`; };

  // ---- 老人端:生活事项 ----
  const shapeEvent = item => ({ ...item, label: item.label || item.typeLabel || '生活事项', owner: item.ownerLabel || item.owner || '等待承接' });
  const events = () => read(scoped(KEYS.events), scope ? [] : (SEED.events || [])).map(shapeEvent);
  const saveEvents = value => write(scoped(KEYS.events), value);
  // 按邮箱读某位老人的事项:家属端用它看已绑定老人共享的内容
  const eventsOf = email => read(KEYS.events + ':' + email, []).map(shapeEvent);
  const permissionsOf = email => read(KEYS.permissions + ':' + email, SEED.permissions || [true, true, true, false]);
  const requestsOf = email => read(KEYS.requests + ':' + email, []);
  const saveRequestsOf = (email, value) => write(KEYS.requests + ':' + email, value);
  const replyRequestFor = (email, id, text) => {
    const list = requestsOf(email);
    const request = list.find(item => item.id === Number(id));
    if (!request) throw new Error('未找到联系请求');
    if (!String(text || '').trim()) throw new Error('请填写回复内容');
    request.reply = String(text).trim();
    request.repliedAt = new Date().toISOString();
    request.status = 'replied';
    saveRequestsOf(email, list);
    return request;
  };

  // ---- 老人端:共享授权(顺序:复诊用药 / 生活服务 / 数字安全 / 社交活动) ----
  const permissions = () => read(scoped(KEYS.permissions), SEED.permissions || [true, true, true, false]);
  const savePermissions = value => write(scoped(KEYS.permissions), value);

  // ---- 老人端:主动联系支持者 ----
  const contacts = () => SEED.contacts || {};
  const requests = () => read(scoped(KEYS.requests), []);
  const saveRequests = value => write(scoped(KEYS.requests), value);
  const sendRequest = (contactId, reason, message) => {
    const all = contacts();
    if (!all[contactId]) throw new Error('未找到联系人');
    const list = requests();
    const request = { id: Date.now(), contactId, name: all[contactId].name, reason, message: String(message || '').trim(), createdAt: new Date().toISOString(), status: 'sent' };
    list.push(request); saveRequests(list); return request;
  };
  const replyRequest = (id, text) => {
    const list = requests(); const request = list.find(item => item.id === Number(id));
    if (!request) throw new Error('未找到联系请求');
    if (!String(text || '').trim()) throw new Error('请填写回复内容');
    request.reply = String(text).trim(); request.repliedAt = new Date().toISOString(); request.status = 'replied';
    saveRequests(list); return request;
  };

  // ---- 三端共读:复诊陪诊确认 ----
  // 老人端点“确认社区陪诊”会写这里,家属端和社区端读同一份状态。
  const escort = () => read(scoped(KEYS.escort), SEED.escort || { status: 'pending' });
  const saveEscort = value => write(scoped(KEYS.escort), value);
  const escortOf = email => read(KEYS.escort + ':' + email, SEED.escort || { status: 'pending' });
  const confirmEscort = who => {
    const next = { ...escort(), status: 'confirmed', respondedAt: new Date().toISOString(), respondedBy: who || '周淑兰' };
    saveEscort(next); return next;
  };

  // ---- 社区端:协同队列与调度规则 ----
  const queue = () => read(KEYS.queue, SEED.queue || []);
  const saveQueue = value => write(KEYS.queue, value);
  const rules = () => read(KEYS.rules, SEED.rules || [true, true, true, true]);
  const saveRules = value => write(KEYS.rules, value);
  const staff = () => SEED.staff || [];

  // ---- 风控:核验记录 + 可信名单 ----
  // 核验记录让“风控”这一步也留痕:家属和社区在授权范围内能看到老人核验过什么。
  const riskChecks = () => read(KEYS.riskChecks, []);
  const saveRiskChecks = value => write(KEYS.riskChecks, value);
  const addRiskCheck = entry => {
    const list = riskChecks();
    list.unshift(entry);
    saveRiskChecks(list.slice(0, 50));
    return entry;
  };
  // 可信名单:与“关键词识别”是两条独立的线——同一条内容,来自可信号码还是陌生号码,结论不同。
  const trustedNumbers = () => read(KEYS.trustedNumbers, SEED.trustedNumbers || []);
  const saveTrustedNumbers = value => write(KEYS.trustedNumbers, value);
  const addTrustedNumber = number => {
    const list = trustedNumbers();
    const digits = String(number).replace(/\D/g, '');
    if (digits && list.indexOf(digits) < 0) { list.push(digits); saveTrustedNumbers(list); }
    return list;
  };
  const trustedDomains = () => read(KEYS.trustedDomains, SEED.trustedDomains || []);
  const saveTrustedDomains = value => write(KEYS.trustedDomains, value);

  // ---- WebMCP(可选):页面能向浏览器里的智能体暴露工具时会用到 ----
  // 注意入口是 navigator.modelContext;旧写法 document.modelContext 并不存在,
  // 之前被 ?. 静默跳过,等于这些工具从未注册成功。
  const modelContext = (typeof navigator !== 'undefined' && navigator.modelContext)
    || (typeof document !== 'undefined' && document.modelContext)
    || null;
  const registerTool = spec => {
    if (!modelContext || typeof modelContext.registerTool !== 'function') return;
    try {
      Promise.resolve(modelContext.registerTool(spec)).catch(error => console.warn('[颐联] 注册智能体工具失败:', spec && spec.name, error));
    } catch (error) {
      console.warn('[颐联] 注册智能体工具失败:', spec && spec.name, error);
    }
  };

  const toast = message => {
    let node = document.querySelector('#toast');
    if (!node) { node = document.createElement('div'); node.id = 'toast'; node.className = 'toast'; node.setAttribute('role', 'status'); document.body.appendChild(node); }
    node.textContent = message; node.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
  };

  // 清掉所有演示数据,回到种子状态
  const resetDemo = () => { ALL_KEYS.forEach(key => { try { localStorage.removeItem(key); } catch {} }); location.reload(); };

  // ---- 外壳:导航、地址栏 hash、抽屉、大字模式 ----
  const initShell = () => {
    const navItems = () => Array.from(document.querySelectorAll('[data-view]'));
    const defaultView = () => (navItems()[0] || {}).dataset?.view;
    const hashView = () => decodeURIComponent(location.hash.replace(/^#\/?/, ''));

    const applyView = name => {
      const target = navItems().find(item => item.dataset.view === name);
      if (!target) return false;
      navItems().forEach(item => {
        const selected = item === target;
        item.classList.toggle('active', selected);
        // aria-current 只接受 "page"/"true" 之类的关键字;写成空字符串等于 false,
        // 屏幕阅读器不会播报当前栏目。这里显式设成 page 或直接移除。
        if (selected) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      });
      document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
      return true;
    };

    const scrollTop = () => {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    };

    const menuButton = document.querySelector('#menuButton');
    const sidebar = document.querySelector('.sidebar');
    const mobileQuery = window.matchMedia('(max-width: 800px)');

    // 极旧浏览器没有 inert:退回用 CSS 里的 visibility:hidden 兜底(见 role.css 的 a11y 层)
    if (!('inert' in HTMLElement.prototype)) document.documentElement.classList.add('no-inert');

    // 收起状态下的抽屉:除了用 transform 移出屏幕,还要真正移出 Tab 序与可访问性树
    const syncDrawer = () => {
      if (!sidebar) return;
      const open = document.body.classList.contains('menu-open');
      sidebar.inert = mobileQuery.matches && !open;
    };
    const closeMenu = restoreFocus => {
      const wasOpen = document.body.classList.contains('menu-open');
      document.body.classList.remove('menu-open');
      menuButton?.setAttribute('aria-expanded', 'false');
      syncDrawer();
      if (wasOpen && restoreFocus && mobileQuery.matches) menuButton?.focus();
    };
    const openMenu = () => {
      document.body.classList.add('menu-open');
      menuButton?.setAttribute('aria-expanded', 'true');
      syncDrawer();
      // 把焦点送进抽屉,键盘用户不必再 Tab 过页面其余部分
      const first = sidebar?.querySelector('.nav-item');
      if (first) first.focus();
    };

    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton?.addEventListener('click', () => {
      if (document.body.classList.contains('menu-open')) closeMenu(true);
      else openMenu();
    });
    document.querySelector('#drawerBackdrop')?.addEventListener('click', () => closeMenu(true));
    document.querySelectorAll('.close-button').forEach(button => {
      if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', '关闭对话框');
    });
    syncDrawer();
    mobileQuery.addEventListener('change', () => { closeMenu(false); });
    // 视口变化后同步,避免从桌面宽度切到移动宽度时抽屉卡在“可聚焦”状态
    window.addEventListener('resize', syncDrawer);

    // 大字模式:把 class 挂在 <html> 上并缩放基准字号,所以 rem 字号会整体变大
    const largeTextButton = document.querySelector('#largeTextBtn');
    const applyLargeText = on => {
      document.documentElement.classList.toggle('large-text', on);
      largeTextButton?.setAttribute('aria-pressed', String(on));
    };
    largeTextButton?.addEventListener('click', () => {
      const on = !document.documentElement.classList.contains('large-text');
      write(KEYS.largeText, on); applyLargeText(on);
    });
    applyLargeText(read(KEYS.largeText, false));

    if (navItems().length) {
      navItems().forEach(button => button.addEventListener('click', () => {
        const name = button.dataset.view;
        // 写进地址栏:可以深链、刷新后停在原视图、浏览器后退能切回上一个视图
        if (hashView() !== name) location.hash = name;
        else applyView(name);
        closeMenu(false);
        scrollTop();
      }));
      window.addEventListener('hashchange', () => { if (!applyView(hashView())) applyView(defaultView()); });
      const initial = hashView();
      if (!applyView(initial)) {
        applyView(defaultView());
        // 首次进入时用 replaceState,避免在历史里塞一条多余的记录
        history.replaceState(null, '', '#' + defaultView());
      }
    }

    document.querySelector('#resetDemoBtn')?.addEventListener('click', () => {
      if (window.confirm('将清空本机保存的演示数据(生活事项、联系消息、共享授权、社区队列),恢复到初始状态。')) resetDemo();
    });

    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(true); });
  };

  window.YL = {
    KEYS,
    read, write, escape, time, md, day, todayLabel,
    events, saveEvents, eventsOf, permissions, savePermissions, permissionsOf,
    contacts, requests, saveRequests, requestsOf, saveRequestsOf, sendRequest, replyRequest, replyRequestFor,
    get scope() { return scope; }, setScope,
    escort, saveEscort, confirmEscort, escortOf,
    queue, saveQueue, rules, saveRules, staff,
    riskChecks, saveRiskChecks, addRiskCheck,
    trustedNumbers, saveTrustedNumbers, addTrustedNumber, trustedDomains, saveTrustedDomains,
    modelContext, registerTool,
    toast, resetDemo, initShell
  };
})();
