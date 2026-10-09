/* 颐联 · 演示种子数据
   这里只放“数据”,不放逻辑。没有后端:所有状态都存在浏览器 localStorage 里,
   首次打开时用下面的值播种。想恢复到初始状态,在入口页点“重置演示数据”。
   存储键见 shared.js 顶部的注释。 */
(function () {
  'use strict';

  // 老人端首页那件“待老人确认”的事。三端都读它,是演示“同一件事在三端之间流动”的主线。
  const escort = {
    id: 'escort-consult',
    title: '明天上午 09:30 复诊',
    place: '市第一医院 · 心内科',
    escortBy: '林芳 · 社区陪诊员',
    note: '社区陪诊员林芳可在就诊前 50 分钟上门。您可以自行确认,也可以先联系女儿商量。',
    status: 'pending',       // pending | confirmed
    respondedAt: null,
    respondedBy: null
  };

  // 老人端的生活事项。家属端按共享授权过滤后读取。
  const events = [
    { id: 1, type: 'health', icon: '医', label: '健康事务', title: '确认明日复诊出行', description: '社区陪诊员林芳等待确认,预计就诊前 50 分钟上门。', state: 'attention', stateLabel: '需确认', owner: '林芳 · 社区专员' },
    { id: 2, type: 'life', icon: '修', label: '生活服务', title: '厨房水龙头维修', description: '张师傅已接单,明天 10:00—11:00 上门。', state: 'progress', stateLabel: '处理中', owner: '张师傅 · 认证服务者' },
    { id: 3, type: 'security', icon: '安', label: '数字安全', title: '陌生缴费短信已核验', description: '家属确认并非燃气公司官方渠道。', state: 'done', stateLabel: '已完成', owner: '周敏 · 家庭联系人' }
  ];

  const contacts = {
    daughter: { name: '周敏', role: '女儿 · 家庭联系人', avatar: '周', note: '通常在 18:00 后方便联系' },
    community: { name: '林芳', role: '春和社区专员', avatar: '林', note: '今日值班至 18:00' },
    repair: { name: '张师傅', role: '认证维修服务者', avatar: '张', note: '明天 10:00—11:00 上门' }
  };

  // 老人端“共享授权”的默认值:顺序与界面上的四行一致。
  const permissions = [true, true, true, false];

  // 社区端调度规则的默认开关状态。
  const rules = [true, true, true, true];

  // 社区端值班人员。tracks = 该人员负责的业务线及其“能力上限”,
  // 面板上的负荷条会按协同队列里他名下的事项数量实时算,不再写死。
  const staff = [
    { id: 'lin', name: '林芳', avatar: '林', role: '社区协同专员', specialty: '综合协调', shift: '08:00—18:00', area: '东片区', availability: '可调度', tracks: [['陪诊协调', 4], ['跨组协同', 4], ['紧急响应', 3]] },
    { id: 'zhao', name: '赵慧', avatar: '赵', role: '健康服务专员', specialty: '陪诊服务', shift: '07:30—16:30', area: '南片区', availability: '外勤中', tracks: [['陪诊服务', 5], ['就医接送', 5], ['复诊回访', 5]] },
    { id: 'wang', name: '王秀英', avatar: '王', role: '生活照护专员', specialty: '生活照护', shift: '09:00—18:00', area: '西片区', availability: '可调度', tracks: [['助洁助浴', 6], ['适老理发', 4], ['生活代办', 5]] },
    { id: 'zhang', name: '张建民', avatar: '张', role: '维修服务专员', specialty: '上门维修', shift: '10:00—19:00', area: '全社区', availability: '上门中', tracks: [['水电维修', 5], ['家电检修', 5], ['适老改造', 4]] },
    { id: 'liu', name: '刘颖', avatar: '刘', role: '健康随访专员', specialty: '慢病随访', shift: '08:30—17:30', area: '北片区', availability: '可调度', tracks: [['慢病随访', 7], ['用药提醒', 6], ['健康建档', 6]] },
    { id: 'chen', name: '陈浩', avatar: '陈', role: '数字安全专员', specialty: '安全核验', shift: '09:00—18:00', area: '线上值守', availability: '可调度', tracks: [['诈骗核验', 5], ['账户咨询', 5], ['安全宣导', 4]] },
    { id: 'sun', name: '孙志强', avatar: '孙', role: '助餐配送专员', specialty: '助餐配送', shift: '06:30—15:30', area: '中心片区', availability: '配送中', tracks: [['助餐配送', 20], ['代买代办', 5], ['物资转运', 4]] },
    { id: 'he', name: '何静', avatar: '何', role: '关怀回访专员', specialty: '关怀回访', shift: '11:00—20:00', area: '重点关怀组', availability: '可调度', tracks: [['电话回访', 7], ['上门关怀', 5], ['家庭协调', 5]] }
  ];

  // 社区端协同队列。
  //   phase  —— 机器可读的状态,用于统计指标(pending 待处理 / active 处理中 / done 已闭环)
  //   status —— 界面上显示的业务状态文案
  //   track  —— 所属业务线,对应上面 staff 的 tracks
  //   escortLinked —— 这条事项的状态跟着老人端“确认社区陪诊”的结果走
  const queue = [
    { id: 'q1', owner: 'lin', risk: 3, time: 18, urgent: true, phase: 'pending', track: '陪诊协调', status: '高优先级', title: '王建国 · 复诊无人陪同', description: '健康事务连续 2 次未完成', deadline: '剩 18 分钟' },
    { id: 'q2', owner: 'lin', risk: 2, time: 60, phase: 'pending', track: '陪诊协调', status: '待确认', escortLinked: true, title: '周淑兰 · 确认陪诊安排', description: '已有陪诊员,等待老人本人确认', deadline: '剩 1 小时' },
    { id: 'q3', owner: 'zhao', risk: 3, time: 35, urgent: true, phase: 'active', track: '陪诊服务', status: '处理中', title: '刘玉梅 · 心内科陪诊', description: '车辆已到达,等待老人下楼', deadline: '剩 35 分钟' },
    { id: 'q4', owner: 'zhao', risk: 2, time: 160, phase: 'pending', track: '就医接送', status: '待确认', title: '钱素珍 · 复诊接送确认', description: '家属已授权社区协助安排', deadline: '剩 2.5 小时' },
    { id: 'q5', owner: 'wang', risk: 2, time: 90, phase: 'pending', track: '助洁助浴', status: '待确认', title: '陈桂香 · 上门助洁', description: '希望由熟悉的服务人员上门', deadline: '剩 1.5 小时' },
    { id: 'q6', owner: 'wang', risk: 1, time: 360, phase: 'pending', track: '适老理发', status: '待出发', title: '赵阿姨 · 适老理发预约', description: '预约今天下午 15:00 上门', deadline: '今天内' },
    { id: 'q7', owner: 'zhang', risk: 2, time: 120, phase: 'active', track: '水电维修', status: '备件中', title: '周淑兰 · 水龙头漏水', description: '已完成初检,需要携带更换配件', deadline: '剩 2 小时' },
    { id: 'q8', owner: 'zhang', risk: 1, time: 420, phase: 'pending', track: '家电检修', status: '待上门', title: '李国强 · 电饭煲检修', description: '设备无法正常保温', deadline: '今天内' },
    { id: 'q9', owner: 'liu', risk: 2, time: 75, phase: 'pending', track: '用药提醒', status: '待回访', title: '张瑞芬 · 用药回访', description: '新处方服用后出现轻微不适', deadline: '剩 1 小时' },
    { id: 'q10', owner: 'liu', risk: 1, time: 300, phase: 'pending', track: '慢病随访', status: '待联系', title: '吴德明 · 血压记录补充', description: '本周记录缺少两次晚间数据', deadline: '今天内' },
    { id: 'q11', owner: 'chen', risk: 3, time: 24, urgent: true, phase: 'pending', track: '诈骗核验', status: '高优先级', title: '陈桂香 · 燃气缴费短信核验', description: '短信要求点击链接并提供验证码', deadline: '剩 24 分钟' },
    { id: 'q12', owner: 'chen', risk: 2, time: 140, phase: 'active', track: '诈骗核验', status: '核验中', title: '王建国 · 陌生客服来电', description: '对方声称医保账户即将冻结', deadline: '剩 2 小时' },
    { id: 'q13', owner: 'sun', risk: 2, time: 42, phase: 'active', track: '助餐配送', status: '配送中', title: '胡秀兰 · 低糖午餐配送', description: '今日餐食需要避开花生制品', deadline: '剩 42 分钟' },
    { id: 'q14', owner: 'sun', risk: 1, time: 110, phase: 'pending', track: '代买代办', status: '待取餐', title: '郭师傅 · 营养餐代取', description: '社区食堂已打包完成', deadline: '剩 1.5 小时' },
    { id: 'q15', owner: 'he', risk: 2, time: 95, phase: 'pending', track: '上门关怀', status: '待上门', title: '孙奶奶 · 连续两日未接电话', description: '家属希望社区安排上门确认', deadline: '剩 1.5 小时' },
    { id: 'q16', owner: 'he', risk: 1, time: 260, phase: 'pending', track: '电话回访', status: '待回访', title: '马伯伯 · 独居关怀回访', description: '本周例行生活状态确认', deadline: '今天内' }
  ];

  window.YL_SEED = { escort, events, contacts, permissions, rules, staff, queue };
})();
