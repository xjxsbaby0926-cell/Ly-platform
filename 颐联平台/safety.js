/* 颐联 · 可疑信息风险识别(纯本地规则,演示用)
   ⚠️ 这是关键字 + 结构的本地匹配,不是真实风控能力,也不会联网。
   要真正可用,需要接入反诈特征库、样本模型与人工复核流程。

   风控范围分三个维度:
     ① 话术  checkText —— 按“诈骗阶段/类型”归类关键词
     ② 链接  checkUrl  —— 域名成分分析(仿冒品牌、可疑顶级域、短链、IP 直连、punycode…)
     ③ 号码  checkPhone—— 号段与格式分析(境外前缀、95/400 冒用、位数异常…)

   命中判定不靠单个词:多类/多维度叠加才升级,并且区分
   “只是提到敏感话题”和“要您去做某个动作”。

   文本匹配前先归一化:全角转半角、您→你、去掉所有空格标点,
   这样“验 证 码”“验证-码”“ＶＸ”这类拆分/变形写法同样能命中。
*/
(function () {
  'use strict';

  const FULLWIDTH = /[！-～]/g;
  const normalize = value => String(value ?? '')
    .replace(FULLWIDTH, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .toLowerCase()
    .replace(/您/g, '你')
    .replace(/[^一-龥a-z0-9]/g, '');

  /* ============================ ① 话术规则 ============================
     权重:3 = 出现就该高度警惕、2 = 典型的施压/诱导手法、1 = 需结合上下文。
     critical = 单独出现也足以判高风险(see check())。 */

  const RULES = [
    {
      id: 'credential', label: '索要验证码 / 密码', weight: 3, critical: true,
      terms: ['验证码', '校验码', '短信码', '动态码', '支付密码', '密码', '银行卡号', '卡号', '社保卡号', '医保卡号', '正反面', '人脸识别', '刷脸', '视频认证', '短信验证'],
      advice: '验证码、密码、证件照片只属于您自己。任何人以任何理由索要,都不要提供——银行和公安不会要这些。'
    },
    {
      // 单独出现说明不了什么(社区通知也会提到身份证),所以权重给得很低。
      // 它只在和其它话术叠加、把总分推上去时才起作用。
      id: 'identity', label: '提到证件 / 银行卡信息', weight: 1,
      terms: ['身份证', '身份证号', '实名认证', '银行卡', '社保卡', '医保卡', '证件', '户口本'],
      advice: '证件照片和银行卡信息不要发给不认识的人,正规机构不会通过短信向您索要这些。'
    },
    {
      /* 摸底 / 套话:上门和电话诈骗的常见开场——
         先问清老人叫什么、是不是一个人住、家里几口人、退休金多少,再决定怎么下手。 */
      id: 'probe', label: '打听个人与家庭情况', weight: 1,
      terms: ['你叫啥', '你叫什么', '叫什么名字', '贵姓', '多大年纪', '你多大', '家里几口人', '几口人', '一个人住', '自己住', '独居', '家里还有谁', '家住哪', '住在哪里', '家庭住址', '退休金多少', '养老金多少', '收入多少'],
      advice: '陌生人打听您的姓名、住址、是否独居、退休金多少,要提高警惕——这是上门和电话诈骗的常见开场,不要告诉对方。'
    },
    {
      id: 'account', label: '声称账户异常 / 要求核验身份', weight: 2,
      terms: ['账户异常', '账号异常', '异常交易', '账户存在异常', '账户被冻结', '风险提醒', '安全风险', '核验身份', '验证身份', '确认身份', '异常登录'],
      advice: '“账户异常,请按提示核验”是典型的钓鱼开场。请通过官方 App 或官方客服电话自行核实,不要拨打短信里的号码。'
    },
    {
      id: 'transfer', label: '要求转账 / 取现 / 先交费用', weight: 3, critical: true,
      terms: ['转账', '汇款', '打款', '安全账户', '资金核查', '资金清算', '验资', '垫付', '保证金', '解冻费', '手续费', '工本费', '公证费', '缴税', '缴纳', '取现', '现金', '汇款单', 'atm', '电子钱包', '数字人民币', '刷流水'],
      advice: '凡是要求向陌生账户转账、或先交“保证金/手续费/解冻费”的,都是诈骗。请先挂断,再和家人核实。'
    },
    {
      /* “把钱打过来”这类通用说法。它单独出现说明不了什么 —— 家人之间也会说“先转给我”,
         所以权重低、也不算关键类;它的价值在于和别的类别(事故、绑架…)组合时把分数推上去。 */
      id: 'pay-order', label: '要求把钱打过来 / 转过来', weight: 2,
      terms: ['打钱', '转钱', '给我打', '打过来', '打到我', '汇过来', '转过来', '转给我', '凑钱', '凑一下', '先打', '先转'],
      advice: '对方在催您把钱打过去。在当面或打电话确认对方身份之前,不要转账。'
    },
    {
      id: 'impersonate', label: '冒充公检法 / 银行 / 官方机构', weight: 2,
      terms: ['公安', '公安局', '派出所', '民警', '警察', '检察院', '法院', '法官', '通缉', '涉案', '立案', '洗钱', '银监会', '人民银行', '保监会', '医保局', '社保局', '卫健委', '民政局', '邮政', '电信', '运营商', '银行', '工信部', '网信办', '反诈中心', '上级部门'],
      advice: '公检法、银行、医保社保都不会通过短信或电话要求您转账、提供密码或“配合调查”。挂断后拨打官方公开电话自行核实。'
    },
    {
      id: 'link', label: '可疑链接 / 下载 App / 屏幕共享', weight: 2,
      terms: ['点击链接', '链接', '网址', '下载', '安装', 'app', '客户端', '扫码', '二维码', '屏幕共享', '共享屏幕', '远程协助', '远程控制', '投屏', 'teamviewer', 'anydesk', '向日葵'],
      advice: '不要点击短信里的链接,不要安装对方推荐的 App,更不要开启“屏幕共享”——那等于把您的手机交给对方操作。'
    },
    {
      id: 'urgency', label: '制造紧迫感 / 限时施压', weight: 2,
      terms: ['立即', '马上', '尽快', '抓紧', '逾期', '冻结', '停用', '注销', '封号', '最后通知', '最后期限', '过期', '失效', '限时', '今日内', '不处理', '后果自负', '起诉', '传唤', '上门核查', '今日24点'],
      advice: '催您“马上处理、否则后果严重”的,就是为了让您来不及思考。任何事都可以先放一放,和家人商量。'
    },
    {
      id: 'secrecy', label: '要求保密 / 避开家人', weight: 3, critical: true,
      terms: ['不要告诉', '别告诉', '不能告诉', '别跟家里说', '不要联系家人', '保密', '独处', '单独', '一个人操作', '不要外传', '别声张', '悄悄'],
      advice: '要求您“不要告诉家人”的,几乎可以确定是诈骗——正常业务不需要保密。'
    },
    {
      id: 'lure', label: '中奖 / 退款 / 补贴 / 返利', weight: 2,
      terms: ['中奖', '中签', '返利', '返现', '退款', '理赔', '退费', '红包', '补贴', '补助', '福利', '免费领取', '0元购', '免单', '抽奖', '积分兑换', '养老金补发', '退税', '消费返现', '领取补贴', '免费送', '养老金上调', '退休金上调', '高龄补贴', '免费领鸡蛋', '免费领米面油'],
      advice: '天上不会掉补贴。先让对方提供可自行核实的官方渠道,再通过公开电话确认,不要按对方给的步骤操作。'
    },
    {
      id: 'investment', label: '投资理财 / 高回报承诺', weight: 3, critical: true,
      terms: ['投资', '理财', '高回报', '稳赚', '保本', '日息', '月息', '年化', '收益', '原始股', '私募', '虚拟货币', '数字货币', '炒币', '外汇', '黄金', '期货', '以房养老', '养老项目', '养老公寓', '股权', '分红'],
      advice: '“稳赚不赔、高回报”是投资诈骗的标志。养老钱不要投给任何人推荐的平台,也不要抵押房产。'
    },
    {
      id: 'fundraiser', label: '集资 / 储值返利 / 互助会', weight: 3, critical: true,
      terms: ['集资', '入股', '合作社', '互助会', '债权转让', '会员卡', '预付卡', '预存', '储值', '消费返利', '返本', '保底收益', '众筹', '养老床位'],
      advice: '承诺固定分红的“养老集资”“储值返利”多半属于非法集资,钱一旦交出去很难追回。交钱前先和家人、社区核实。'
    },
    {
      id: 'health', label: '保健品 / 神药 / 免费体检', weight: 1,
      terms: ['保健品', '特效药', '神药', '包治', '根治', '免费体检', '义诊', '养生讲座', '祖传秘方', '专家推荐', '试用装', '健康讲座', '量子', '细胞疗法', '干细胞', '免费体验'],
      advice: '保健品不能替代正规就医。涉及缴费、停药或推荐“专家”时,先问社区医生和家属。'
    },
    {
      id: 'hospital', label: '冒充医院 / 挂号 / 体检报告', weight: 2,
      terms: ['体检报告异常', '挂号成功', '预约挂号', '专家号', '病历', '就诊记录', '医保报销', '住院押金', '手术押金', '报告异常'],
      advice: '医院不会通过短信让您转账或点链接交押金。有疑问请打医院官方公开电话,或让家属帮您核实。'
    },
    {
      id: 'travel', label: '低价 / 免费老年旅游', weight: 2,
      terms: ['免费旅游', '低价旅游', '特价旅游', '旅游团', '康养旅游', '旅居养老', '组团出游', '报名费', '出团押金'],
      advice: '低价甚至“免费”的老年旅游团,常靠强制购物和推销保健品回本。报名前先和家人商量,不要交大额押金。'
    },
    {
      id: 'collectible', label: '收藏品 / 古董 / 高价回收', weight: 2,
      terms: ['收藏品', '古董', '字画', '纪念币', '邮票', '玉器', '拍卖', '鉴定费', '升值空间', '高价回收', '上门收购'],
      advice: '“高价回收”“交鉴定费就能帮您拍卖”是收藏品诈骗的固定套路——正规机构不会先向藏家收钱。'
    },
    {
      id: 'pension-agent', label: '代办社保 / 一次性补缴养老金', weight: 3, critical: true,
      terms: ['代办社保', '补缴社保', '一次性补缴', '养老金代办', '提前退休', '社保挂靠', '代缴社保', '补缴养老金', '代办退休'],
      advice: '社保只能通过官方渠道办理。任何“花钱就能代办、一次性补缴”的说法都是骗局,还可能让您失去待遇。'
    },
    {
      id: 'utility', label: '水电燃气 / 宽带欠费', weight: 2,
      terms: ['燃气欠费', '水费欠费', '电费欠费', '账单逾期', '宽带欠费', '欠费停供', '欠费停电', '上门抄表', '补缴费用'],
      advice: '水电燃气欠费请通过官方 App 或账单上的官方电话核实,不要点短信里的链接去缴费。'
    },
    {
      id: 'shopping', label: '低价购物 / 订单异常退款', weight: 2,
      terms: ['限时特价', '厂家直销', '仅需邮费', '货到付款', '退货理赔', '订单异常', '商品异常', '订单失效', '双倍赔付'],
      advice: '“只付邮费免费送”“订单异常要给您退款”都是常见套路。正规退款只会原路返回,不会让您提供银行卡信息或点陌生链接。'
    },
    {
      id: 'gambling', label: '网络博彩 / 彩票内幕', weight: 3, critical: true,
      terms: ['博彩', '彩票内幕', '六合彩', '时时彩', '投注', '包赚', '内部消息', '代购彩票', '棋牌室', '带单'],
      advice: '网络赌博和所谓“彩票内幕”本身就是违法的,先让您尝甜头是固定套路。请直接拒绝,并告诉家人。'
    },
    {
      /* 拆成三条,避免误伤:
         · romance —— 只留“和陌生人建立感情”的信号,这一类才够得上高风险
         · custody —— 让您代收代管钱物、借用银行卡(可能卷入洗钱),中等
         · borrow  —— “急用钱、周转”这类通用说法,家人之间也会讲,只做低风险提示 */
      id: 'romance', label: '网恋 / 情感诱导', weight: 3, critical: true,
      terms: ['网恋', '交友', '相亲', '婚介', '知心', '黄昏恋', '找个伴'],
      advice: '网上的“知心人”一旦提到钱、银行卡、代收包裹,就要立刻警惕——这是“杀猪盘”的常用手法。'
    },
    {
      id: 'custody', label: '让您代收代管钱物 / 借用银行卡', weight: 2,
      terms: ['代为保管', '帮我保管', '寄放', '银行卡借我用', '借用银行卡', '帮我收快递', '帮我转账', '帮我取钱', '帮我收钱', '借我的卡'],
      advice: '把自己的银行卡、账户借给别人收款转账,可能让您卷入洗钱。任何“帮忙收一下钱”的请求都要拒绝,并告诉家人。'
    },
    {
      id: 'borrow', label: '开口借钱 / 资金周转', weight: 1,
      terms: ['借我', '借点', '周转', '急用钱', '救急', '垫一下', '先用一下', '先借着'],
      advice: '亲友开口借钱,请用您原来存的号码回拨确认,不要用短信里给的联系方式。'
    },
    {
      id: 'fake-kin', label: '冒充亲友 / 换号借钱', weight: 3, critical: true,
      terms: ['我换号了', '这是我的新号', '新号码', '手机丢了', '借点钱', '急需用钱', '帮忙垫一下', '我是你儿子', '我是你女儿', '我是你孙子', '猜猜我是谁'],
      advice: '通过换号、新号码借钱的,务必用您原来存的号码回拨确认,不要按对方给的新号码联系。'
    },
    {
      /* 恐吓型。拆成两条:人身威胁本身就很硬(单独出现即高风险),
         而“住院/车祸”这类可能只是家人报信,单独出现只做低风险提示,
         配上要钱才由下面的组合信号升级。 */
      id: 'kidnap', label: '绑架 / 人身安全威胁', weight: 3, critical: true,
      terms: ['被绑架', '绑架', '赎金', '撕票', '不让走', '扣住了', '在我们手里', '不许报警', '不要报警'],
      advice: '任何声称“人质在手、必须立刻打钱、不许报警”的,都是诈骗。请先挂断,直接联系亲人本人,或拨打 110 核实。'
    },
    {
      id: 'accident', label: '谎称亲人出事故 / 住院', weight: 2,
      terms: ['出车祸', '车祸', '被车撞', '撞人了', '把人撞了', '被抓', '被拘留', '进医院', '住院了', '在抢救', '马上手术', '急病', '出事了', '出事', '欠钱被扣', '保释', '赔钱', '你儿子', '你女儿', '你孙子', '你孙女'],
      advice: '“亲人出事、必须马上打钱”是最容易让人慌乱的诈骗。请先挂断,直接打亲人本人或他身边人的电话确认——真出事时,对方不会只让您转账。'
    },
    {
      id: 'aifake', label: '换脸 / 合成语音冒充熟人', weight: 2,
      terms: ['开个视频', '视频通话', '换个安静的地方', '信号不好别挂', '别挂电话', '换脸', '合成', 'ai'],
      advice: '现在有人用换脸和合成语音冒充亲友。视频里让对方用手在脸前挥一下,或问一件只有你们俩知道的事,再确认身份。'
    },
    {
      id: 'offline', label: '线下见面 / 上门取钱取物', weight: 1,
      terms: ['线下', '当面', '上门取', '上门收', '上门办理', '交给工作人员', '送钱', '取现金', '见面交易', '面交', '送到家里', '派人来取', '约个地方'],
      advice: '如果是刚认识的人提出线下见面、或上门取钱取物,请先跟家人或社区说一声。正常业务不会让您把现金交给陌生人。'
    },
    {
      id: 'job', label: '刷单 / 兼职 / 贷款', weight: 2,
      terms: ['刷单', '兼职', '日结', '日入', '轻松赚钱', '点赞赚钱', '做任务', '贷款', '代办信用卡', '提额', '征信修复', '过桥', '无抵押', '秒批'],
      advice: '“刷单赚佣金”本身就是违法行为,凡是让您先垫钱的兼职都是诈骗;贷款不要交给任何“代办”。'
    },
    {
      id: 'parcel', label: '快递 / 包裹异常', weight: 1,
      terms: ['快递', '包裹', '邮件', '海关', '扣押', '退运', '补缴关税', '包裹异常', '地址异常'],
      advice: '快递问题请通过官方 App 或官方客服核实,不要点短信里的链接,也不要交“关税/保管费”。'
    },
    {
      /* 引导离开平台去私聊,是几乎所有短信诈骗的必经一步 —— 脱离平台就没有任何留痕和拦截。
         但熟人之间也会说“加个微信”,所以不单独判高风险:它自己只到中等,靠组合信号升级。 */
      id: 'offplatform', label: '引导添加私人联系方式 / 进群', weight: 2,
      terms: ['加微信', '加个微信', '加我微信', '加一下微信', '私人微信', '微信号', '加qq', '加个qq', '加好友', '私聊', '私加', '扫码进群', '拉你进群', '助理微信', '客服微信', '专属顾问', '加群', '群里有老师'],
      advice: '要求您转到微信/QQ 私下联系的,是为了脱离平台监管。请留在官方渠道处理,不要添加对方给的联系方式。'
    },
    {
      id: 'medical-card', label: '医保卡套现 / 回收药品', weight: 3, critical: true,
      terms: ['医保卡套现', '套现', '回收药品', '回收医保', '刷卡买药', '药品回收', '医保余额提现', '医保卡换钱'],
      advice: '医保卡套现是违法的,参与的人会被暂停医保待遇,严重的还要担责。请直接拒绝并告诉家人。'
    },
    {
      id: 'utility-visit', label: '冒充上门检修 / 免费安检', weight: 2,
      terms: ['上门检修', '上门安装', '免费安检', '燃气安检', '更换燃气表', '安全阀', '上门检测', '免费换表', '入户检查'],
      advice: '有人上门说“免费检修/换表”时,先打燃气、电力或自来水公司的官方客服核实工单,不要让没预约过的人进门。'
    },
    {
      id: 'traffic', label: '冒充交管 / 违章罚单', weight: 2,
      terms: ['违章', '罚单', '交通违法', '扣分', '年检', '驾驶证异常', 'etc', '停用etc', '违章处理'],
      advice: '交通违章请通过交管 12123 官方 App 查询和处理,不要点短信里的链接,也不要在陌生页面输入车牌和身份证。'
    },
    {
      id: 'tradein', label: '以旧换新 / 下乡补贴', weight: 1,
      terms: ['以旧换新', '家电下乡', '下乡补贴', '旧家电回收', '更换补贴', '换新补贴'],
      advice: '补贴类政策请通过官方渠道核实,正规政策不会要求您先交钱或先扫码登记银行卡。'
    }
  ];

  // 这些类别是“要您去做某个动作”的话术(转账、给验证码、点链接、保密……)。
  // 只有出现这类话术(或一个可疑链接)才够得上中等风险;
  // 单纯“提到”身份证、体检、快递这类话题不算 —— 社区通知里也会出现。
  const ACTION_RULES = ['credential', 'transfer', 'link', 'urgency', 'secrecy', 'lure', 'investment', 'fundraiser', 'hospital', 'travel', 'collectible', 'pension-agent', 'utility', 'shopping', 'gambling', 'romance', 'custody', 'fake-kin', 'aifake', 'offline', 'job', 'account', 'offplatform', 'medical-card', 'utility-visit', 'traffic', 'tradein'];

  /* ==================== 组合信号(跨类别共现) ====================
     单看每一条都是普通词,凑在一起才说明问题。
     这类组合比单个关键词更能识别"换个说法"的变体,也更少误报。 */
  const PATTERNS = [
    {
      id: 'otp+secrecy', label: '索要验证码 + 要求保密', weight: 3, critical: true,
      test: c => c.has('credential') && c.has('secrecy'),
      advice: '“把验证码告诉我,别告诉别人”是最典型的组合——这一定是诈骗,请直接挂断并联系家人。'
    },
    {
      id: 'transfer+urgency', label: '要求转账 + 施加时间压力', weight: 2,
      test: c => c.has('transfer') && c.has('urgency'),
      advice: '“马上转账,否则……”是标准的施压组合,目的就是让您来不及和家人商量。'
    },
    {
      id: 'impersonate+transfer', label: '冒充官方机构 + 要求转账', weight: 2,
      test: c => c.has('impersonate') && c.has('transfer'),
      advice: '自称官方机构又要求转账的,一定是诈骗——官方机构不会用这种方式收钱。'
    },
    {
      id: 'link+credential', label: '要求点链接 + 填写验证码/密码', weight: 2,
      test: c => c.has('link') && c.has('credential'),
      advice: '“点链接 + 填验证码”就是钓鱼页面在直接套您的账户,请立即关闭页面。'
    },
    {
      id: 'offplatform+money', label: '引导私下联系 + 涉及资金或账户', weight: 2,
      test: c => c.has('offplatform') && (c.has('account') || c.has('transfer') || c.has('investment')),
      advice: '先让您加私人微信、再谈钱和账户的,几乎都是诈骗——分两步就是为了不留痕迹。'
    },
    {
      id: 'probe+offplatform', label: '先摸底 + 引导私下联系', weight: 3,
      test: c => c.has('probe') && c.has('offplatform'),
      advice: '先打听您家里的情况、再让您加私人微信,是上门诈骗的典型铺垫,请直接拒绝。'
    },
    {
      id: 'link+brand', label: '可疑链接 + 冒充官方', weight: 2,
      test: c => c.has('impersonate') && c.links.some(item => item.level >= 2),
      advice: '短信自称官方、链接又不是官方域名的,不要点——请自己打开官方 App 操作。'
    },
    {
      /* 借助可信名单做的“发信人”判断:号码不在可信名单里,又同时谈钱或验证码。
         这是轻量版的“发信人身份”——真实系统里应由服务端直接给出号码归属。 */
      id: 'stranger+money', label: '陌生号码 + 涉及资金或验证码', weight: 2,
      test: c => c.phones.some(item => !item.trusted && item.level > 0) && (c.has('transfer') || c.has('credential') || c.has('account')),
      advice: '这个号码不在您的可信名单里,又同时提到了账户或验证码。请不要回拨,改用官方 App 或官方公开电话核实。'
    },
    {
      /* 恐吓型的固定结构:一边说亲人出事、一边要钱。
         单看“住院了”“出车祸”可能只是家人报信,配上要钱才是诈骗。 */
      id: 'accident+money', label: '谎称亲人出事 + 要求打钱', weight: 3, critical: true,
      test: c => (c.has('accident') || c.has('kidnap')) && (c.has('transfer') || c.has('pay-order') || c.has('credential') || c.has('secrecy') || c.has('demand_money')),
      advice: '一边说亲人出事、一边让您打钱,这是恐吓型诈骗的固定结构。请先挂断,直接打亲人本人或他身边人的电话核实。'
    }
  ];

  /* 已经转了钱或已经给出验证码时,需要的不是“下次注意”,而是马上要做的几步。
     这部分把风控从“识别”接上“事后处置”。 */
  const EMERGENCY = [
    '打 110 报警,或拨打全国反诈专线 96110 说明情况。',
    '打银行客服电话挂失或冻结账户——号码用银行卡背面印的,不要用短信里给的号码。',
    '修改网银、支付和常用账号的密码,并请家人帮忙开启转账限额与到账提醒。',
    '保留短信、通话记录、对方账号和转账凭证,先不要删除,这些是报案证据。'
  ];

  const LEVELS = {
    high: { label: '高风险', short: '高风险', headline: '这类内容高度符合已知的诈骗话术,请先不要做任何操作。' },
    medium: { label: '中等风险', short: '中等风险', headline: '出现了值得警惕的特征,建议先停下来核实。' },
    low: { label: '低风险提示', short: '低风险提示', headline: '没有典型的诈骗话术,但有需要留意的点。' },
    none: { label: '暂未发现', short: '未发现风险', headline: '没有匹配到已知的诈骗特征,但这不等于一定安全。' }
  };

  /* ============================ ② 链接分析 ============================ */

  // 常被用于诈骗的顶级域(注册便宜、审核松)
  const RISKY_TLDS = ['top', 'xyz', 'vip', 'cc', 'icu', 'buzz', 'live', 'click', 'link', 'online', 'site', 'shop', 'work', 'men', 'loan', 'win', 'bid', 'stream', 'tk', 'ml', 'ga', 'gq', 'cf', 'pw', 'asia', 'kim', 'date', 'racing', 'party', 'science', 'trade', 'info', 'biz', 'club', 'rest', 'bar', 'monster', 'quest', 'sbs', 'lol', 'mom', 'review', 'country', 'webcam', 'accountant', 'cricket', 'song', 'download', 'zip', 'mov'];

  // 短链服务:看不见真实目的地
  const SHORTENERS = ['t.cn', 'url.cn', 'dwz.cn', 'sourl.cn', 'suo.im', 'mrw.so', 'sina.lt', 'w.url.cn', '6url.cn', 'bit.ly', 'tinyurl.com', 'is.gd', 'goo.gl', 'ow.ly', 'rb.gy', 'cutt.ly', 'shorturl.at', 't.ly', 'rebrand.ly'];

  // 官方域名:域名里出现品牌词但不是这个官方域 → 疑似仿冒
  const BRAND_DOMAINS = [
    { key: '10086', official: '10086.cn', name: '中国移动' },
    { key: '10010', official: '10010.com', name: '中国联通' },
    { key: '189', official: '189.cn', name: '中国电信' },
    { key: 'icbc', official: 'icbc.com.cn', name: '工商银行' },
    { key: 'ccb', official: 'ccb.com', name: '建设银行' },
    { key: 'abchina', official: 'abchina.com', name: '农业银行' },
    { key: 'boc', official: 'boc.cn', name: '中国银行' },
    { key: 'bankcomm', official: 'bankcomm.com', name: '交通银行' },
    { key: 'cmbchina', official: 'cmbchina.com', name: '招商银行' },
    { key: 'psbc', official: 'psbc.com', name: '邮储银行' },
    { key: 'unionpay', official: 'unionpay.com', name: '银联' },
    { key: 'alipay', official: 'alipay.com', name: '支付宝' },
    { key: 'weixin', official: 'weixin.qq.com', name: '微信' },
    { key: 'taobao', official: 'taobao.com', name: '淘宝' },
    { key: 'tmall', official: 'tmall.com', name: '天猫' },
    { key: 'jd', official: 'jd.com', name: '京东' },
    { key: 'pinduoduo', official: 'pinduoduo.com', name: '拼多多' },
    { key: 'meituan', official: 'meituan.com', name: '美团' },
    { key: '12333', official: '12333.gov.cn', name: '人社服务' },
    { key: '12315', official: '12315.cn', name: '市场监管' }
  ];

  const URL_RE = /(?:https?:\/\/|www\.)[^\s，。、；：！？"'（）()【】《》]+|(?:[a-z0-9][a-z0-9-]{0,62}\.)+(?:com|cn|net|org|top|xyz|vip|cc|icu|buzz|live|click|link|online|site|shop|work|men|loan|win|bid|stream|tk|ml|ga|gq|cf|pw|asia|kim|date|racing|party|science|trade|info|biz|club|rest|bar|monster|quest|sbs|lol|mom|review|country|webcam|accountant|cricket|zip|mov)(?::\d{2,5})?(?:\/[^\s，。、；：！？"'（）()【】《》]*)?/gi;

  const checkUrl = (raw, trusted) => {
    const domains = (trusted && trusted.domains) || [];
    const text = String(raw || '');
    const found = text.match(URL_RE) || [];
    const seen = new Set();
    const out = [];
    found.forEach(match => {
      const url = match.replace(/[.,，。]+$/, '');
      const host = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[\/?#]/)[0].split(':')[0].toLowerCase();
      if (!host || seen.has(host)) return;
      seen.add(host);
      // 命中可信域名直接放行。按后缀匹配,所以 icbc.com.cn.evil.top 这种"前缀伪装"不会被误信
      if (domains.some(suffix => host === suffix || host.endsWith('.' + suffix))) {
        out.push({ url, host, level: 0, trusted: true, notes: ['在您的可信域名名单里'] });
        return;
      }
      let level = 0;
      const notes = [];

      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) { level = 3; notes.push('直接用 IP 地址,正规机构不会这样发链接'); }
      if (host.indexOf('xn--') >= 0) { level = 3; notes.push('使用了 punycode 编码,极可能是把域名伪装成相似的官方域名'); }
      if (url.indexOf('@') >= 0) { level = 3; notes.push('链接里带 @ 符号,真实域名可能藏在后面'); }
      if (/^https?:\/\//i.test(url) === false && /^\d/.test(host)) { level = Math.max(level, 2); notes.push('以数字开头的裸域名'); }

      SHORTENERS.some(short => { if (host === short || host.endsWith('.' + short)) { level = Math.max(level, 2); notes.push('短链接,看不到真实地址'); return true; } return false; });

      const tld = host.split('.').pop();
      if (RISKY_TLDS.indexOf(tld) >= 0) { level = Math.max(level, 2); notes.push('“.' + tld + '”这类顶级域名常被用于诈骗'); }

      BRAND_DOMAINS.forEach(brand => {
        // 短品牌词(jd / boc / 189)只按分段匹配,避免命中普通单词造成误报
        const appears = brand.key.length <= 3
          ? host.split(/[.\-_]/).indexOf(brand.key) >= 0
          : host.indexOf(brand.key) >= 0;
        if (!appears) return;
        const isOfficial = host === brand.official || host.endsWith('.' + brand.official);
        if (!isOfficial) { level = 3; notes.push('域名里带“' + brand.key + '”,但不是' + brand.name + '的官方域名(' + brand.official + ')'); }
      });

      if (host.length > 30) { level = Math.max(level, 2); notes.push('域名异常长,常用于隐藏真实地址'); }
      const dashes = (host.match(/-/g) || []).length;
      if (dashes >= 2) { level = Math.max(level, 2); notes.push('域名里连字符过多,常见于仿冒'); }
      if (/(gov\.cn|edu\.cn)$/.test(host) && !/\.(gov\.cn|edu\.cn)$/.test(host)) { level = Math.max(level, 2); notes.push('在非官方域名里冒充 .gov.cn / .edu.cn'); }

      if (!notes.length) { notes.push('未发现明显异常,但陌生链接仍建议不要在手机上直接打开'); }
      out.push({ url, host, level, trusted: false, notes });
    });
    return out;
  };

  /* ============================ ③ 号码分析 ============================ */

  // 这些是真实的官方公开号码,命中就不算可疑
  const KNOWN_NUMBERS = ['110', '119', '120', '122', '12315', '12333', '12345', '12348', '96110', '10086', '10010', '10000', '95588', '95533', '95566', '95599', '95555', '95511', '95595', '95561', '95508', '95501'];

  const checkPhone = (raw, trusted) => {
    const numbers = (trusted && trusted.numbers) || [];
    const text = String(raw || '');
    const candidates = text.match(/\+?[\d][\d\s\-()]{3,}\d/g) || [];
    const seen = new Set();
    const out = [];
    candidates.forEach(cand => {
      let digits = cand.replace(/\D/g, '');
      // 去掉 +86 / 86 前缀,还原成国内号码
      const stripped = digits.replace(/^86(?=1[3-9]\d{9}$)/, '');
      const base = stripped;
      if (base.length < 5 || seen.has(base)) return;
      seen.add(base);

      // 命中可信名单直接放行(官方号码,或家人、社区登记过的联系方式)
      if (numbers.indexOf(base) >= 0) {
        out.push({ number: cand.trim(), level: 0, trusted: true, notes: ['在您的可信名单里(官方号码,或家人与社区登记过的联系方式)'] });
        return;
      }

      let level = 0;
      const notes = [];
      if (KNOWN_NUMBERS.indexOf(base) >= 0) {
        notes.push('与官方公开号码一致;但仍建议通过官方 App 或官网核实');
      } else if (/^00/.test(digits)) {
        level = 3; notes.push('以 00 开头,是境外来电/短信的常见前缀');
      } else if (/^\+\d/.test(cand.trim()) && !/^86/.test(digits)) {
        level = 3; notes.push('境外号码,冒充公检法的案件里很常见');
      } else if (/^95\d{3,5}$/.test(base)) {
        level = 2; notes.push('95 开头的客服号段,常被冒用;不要直接回拨,请通过官方渠道核实');
      } else if (/^400\d{7}$/.test(base)) {
        level = 2; notes.push('400 号码,常被冒用成“客服”;正规 400 一般只接不打');
      } else if (/^1[3-9]\d{9}$/.test(base)) {
        level = 1; notes.push('普通手机号');
      } else if (base.length >= 12) {
        level = 2; notes.push('位数异常,可能是拼接或改号');
      } else {
        level = 1; notes.push('非标准号码格式');
      }

      // 仿冒官方号码:与官方号只差一两位(如 100861 仿 10086)。
      // 只在长度接近时才判定——否则“长号码里恰好包含短号”会大量误报
      // (例如 4001234567 里包含 12345)。
      KNOWN_NUMBERS.forEach(known => {
        if (base === known || known.length < 5) return;
        if (Math.abs(base.length - known.length) <= 1 && base.indexOf(known) >= 0) {
          level = 3;
          notes.push('与官方号码 ' + known + ' 高度相似但不一致,疑似仿冒官方号码');
        }
      });

      out.push({ number: cand.trim(), level, trusted: false, notes });
    });
    return out;
  };

  /* ============================ 结构特征 ============================ */

  const AMOUNT_RE = /\d+(?:\.\d+)?\s*(?:万元|万|元|块|w)/i;
  // 中文数字金额:“打十万”“五万元”“叁万块”。老人收到的短信里几乎不用阿拉伯数字,
  // 只认数字会整条漏掉——这是实测踩到的坑。
  const CN_DIGIT = '零〇一二三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟两';
  const CN_AMOUNT_RE = new RegExp('[' + CN_DIGIT + ']+(?:万元|万|元|块|千元|百元)|(?:打|转|汇|取|交|付|凑|要)[' + CN_DIGIT + ']{2,}');
  // “索要金额”的结构信号:动词 + 金额(中间允许夹几个字,比如“打五万押金过来”)。
  // 这和单纯“提到金额”不同 —— “这个月电费一百二十元”不该算,所以它单独成为一个信号。
  const ASK_MONEY_RE = new RegExp('(?:打|转|汇|交|付|凑|取|拿|准备)[^,。;!?、\\s]{0,8}(?:[' + CN_DIGIT + ']{2,}|\\d{3,})');
  const OBFUSCATED_RE = /[一-龥]([\s·・\-_~]+[一-龥]){2,}/;
  const TRADITIONAL_RE = /[個們麼這來對時開關發錢銀證騙務員網電話親愛寶買賣體醫藥單準確]/;
  const BLAST_RE = /退订回?\s*[tT]|回\s*[tT]\s*退订/;
  const SYMBOL_RE = /[★☆▲●◆■◎※=`^]{2,}/;

  /* ============================ 综合判定 ============================ */

  const check = (text, trusted) => {
    const raw = String(text || '');
    const norm = normalize(raw);
    const textWithoutUrl = raw.replace(URL_RE, ' ');

    // ① 话术
    const hits = [];
    RULES.forEach(rule => {
      const found = rule.terms.filter(term => norm.indexOf(normalize(term)) >= 0);
      if (found.length) hits.push({ id: rule.id, label: rule.label, weight: rule.weight, critical: Boolean(rule.critical), terms: found, advice: rule.advice });
    });

    const flags = [];
    if (OBFUSCATED_RE.test(raw)) flags.push({ id: 'obfuscated', weight: 1, text: '疑似把关键词用空格/符号拆开(常见于规避拦截)' });
    if (AMOUNT_RE.test(raw) || CN_AMOUNT_RE.test(raw)) flags.push({ id: 'amount', weight: 1, text: '涉及具体金额' });
    if (ASK_MONEY_RE.test(raw)) flags.push({ id: 'demand_money', weight: 2, text: '要求您把钱打过去 / 交过去' });
    if (TRADITIONAL_RE.test(raw)) flags.push({ id: 'traditional', weight: 1, text: '混用繁体字(常见于境外发送的短信)' });
    if (BLAST_RE.test(raw)) flags.push({ id: 'blast', weight: 1, text: '带“退订回T”等群发标记,通常是批量群发' });
    if (SYMBOL_RE.test(raw)) flags.push({ id: 'symbol', weight: 1, text: '堆叠异常符号,常见于群发或伪装' });
    if (/\d{15,}/.test(raw)) flags.push({ id: 'longnumber', weight: 1, text: '出现超长数字串(可能是拼接的账号或改号)' });
    // 用字母冒充数字的号码写法:1oo86、l0086 —— 常见的规避拦截手段
    const confusable = (raw.match(/[0-9oOlI]{5,}/g) || []).filter(token =>
      /[oOlI]/.test(token) && (token.match(/\d/g) || []).length >= 3);
    if (confusable.length) flags.push({ id: 'confusable', weight: 2, text: '号码里混入字母(o/l/I 冒充 0/1),常见于规避拦截' });

    // ② 链接 / ③ 号码
    const links = checkUrl(raw, trusted);
    const phones = checkPhone(textWithoutUrl, trusted);

    // 组合信号:跨类别共现,先算出来再计入总分
    const ctx = {
      hits, flags, links, phones, raw,
      has: id => hits.some(hit => hit.id === id) || flags.some(flag => flag.id === id)
    };
    const patterns = PATTERNS.filter(rule => { try { return rule.test(ctx); } catch { return false; } });

    const score = hits.reduce((n, hit) => n + hit.weight, 0)
      + patterns.reduce((n, item) => n + item.weight, 0)
      + flags.reduce((n, flag) => n + flag.weight, 0)
      + links.reduce((n, item) => n + item.level, 0)
      + phones.reduce((n, item) => n + item.level, 0);

    let level = score >= 6 ? 'high' : score >= 2 ? 'medium' : score >= 1 ? 'low' : 'none';
    // 命中“关键类”话术(索要验证码 / 要求转账 / 要求保密 / 换号借钱 / 高回报投资 …)就不再降级
    if (hits.some(hit => hit.critical) && score >= 3) level = 'high';
    // 命中关键组合(例如“验证码 + 保密”)同样直接算高风险
    if (patterns.some(item => item.critical) && score >= 3) level = 'high';
    // 仿冒官方域名 / 境外号码 / 仿冒官方号码,直接算高风险
    if (links.some(item => item.level >= 3) && score >= 3) level = 'high';
    // 境外号码本身可疑但不算结论(也可能是国外的亲戚),所以要求还有别的线索呼应
    if (phones.some(item => item.level >= 3) && score >= 4) level = 'high';
    // 只是“提到”敏感话题不算风险:至少要有一条“要您去做某个动作”的话术、一个组合信号或一个可疑链接
    const hasAction = hits.some(hit => ACTION_RULES.indexOf(hit.id) >= 0) || patterns.length > 0 || links.some(item => item.level >= 2);
    if (level === 'medium' && !hasAction) level = 'low';

    const advice = [];
    patterns.forEach(item => { if (advice.indexOf(item.advice) < 0) advice.push(item.advice); });
    hits.forEach(hit => { if (advice.indexOf(hit.advice) < 0) advice.push(hit.advice); });
    if (links.length) advice.push('点开链接前,先自己打开官方 App 或输入官方网址核对一遍;陌生域名不要在手机上直接点。');
    if (phones.some(item => item.level >= 2)) advice.push('不要回拨对方给的号码,改用官方 App 或官方公开电话联系。');
    if (level === 'high' || level === 'medium') advice.push('先不要按对方说的做。可以拨打全国反诈专线 96110,或联系社区专员与家人一起确认。');

    const emergency = (level === 'high' || level === 'medium') ? EMERGENCY : null;
    return { raw, level, score, hits, patterns, flags, links, phones, advice, emergency };
  };

  // 演示用的几条典型内容,方便快速试出不同维度与等级
  const SAMPLES = [
    { label: '医保冻结+要求转账', text: '【医保局】您的医保账户存在异常,将在今日24点前冻结,请立即点击链接完成实名认证,并将资金转入安全账户,不要告诉家人。' },
    { label: '仿冒银行域名', text: '【工商银行】您的账户存在异常交易,请点击 http://icbc-safe.top/verify 核实身份,逾期将冻结账户。' },
    { label: '境外号码', text: '您有一份法院传票未签收,请立即拨打 00852-98765432 联系办案人员处理,否则将依法冻结您的账户。' },
    { label: '冒充子女换号借钱', text: '妈,我换号了,手机丢了,急需用钱你先转5000到这个卡上,别打电话我这边不方便。' },
    { label: '谎称儿子被绑架', text: '你儿子被绑架了,先给我打十万,不许报警,否则就来不及了。' },
    { label: '代办补缴养老金', text: '专业代办一次性补缴社保,补缴后每月多领1200元,名额有限,先交3800元服务费即可办理。' },
    { label: '拆开写的验证码', text: '请把收到的验 证 码 告 诉 我,帮您完成实名认证。' }
  ];

  /* ============================ 结果渲染 ============================
     三端共用同一套报告结构,省得每个页面各写一份。
       options.allowTrust —— 是否显示“这个号码是可信的”按钮
                             (只有老人端有权改自己那份可信名单)
       options.actions    —— 调用方自定义的操作区 HTML(发给家人 / 生成协同事项 …) */
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));

  const renderReport = (result, options) => {
    const opts = options || {};
    const level = LEVELS[result.level] || LEVELS.none;
    const head = `<div class="risk-head"><span class="risk-level ${result.level}">${level.label}</span><strong>${esc(level.headline)}</strong></div>`;
    const nothing = !result.hits.length && !result.patterns.length && !result.flags.length && !result.links.length && !result.phones.length;
    if (nothing) {
      return `<div class="risk-report">${head}<p class="risk-note">涉及资金和账户信息时,仍然要通过官方公开渠道独立核实。</p></div>`;
    }
    const section = (title, body) => `<section class="risk-section"><h4>${title}</h4>${body}</section>`;
    const patterns = result.patterns.map(item => `<li class="risk-pattern">${esc(item.label)}</li>`).join('');
    const cats = result.hits.map(hit => `<li class="risk-cat"><b>${esc(hit.label)}</b><div class="risk-terms">${hit.terms.map(term => `<span class="risk-term">${esc(term)}</span>`).join('')}</div></li>`).join('');
    const flags = result.flags.map(flag => `<span class="risk-flag">${esc(flag.text)}</span>`).join('');
    const findings = (items, withTrust) => items.map(item => {
      const name = item.url || item.number;
      const trust = withTrust && opts.allowTrust && !item.trusted
        ? `<button type="button" class="text-button" data-trust-number="${esc(item.number)}">这个号码是可信的</button>` : '';
      return `<li class="risk-item level-${item.level}"><b>${esc(name)}</b><span>${item.notes.map(esc).join(';')}</span>${trust}</li>`;
    }).join('');
    const advice = result.advice.map(item => `<li>${esc(item)}</li>`).join('');
    const emergency = result.emergency ? section('如果已经操作了,现在就做', `<ol class="risk-emergency">${result.emergency.map(item => `<li>${esc(item)}</li>`).join('')}</ol>`) : '';
    return [
      '<div class="risk-report">',
      head,
      result.patterns.length ? section('组合信号', `<ul class="risk-patterns">${patterns}</ul>`) : '',
      result.hits.length ? section('可疑话术', `<ul class="risk-cats">${cats}</ul>`) : '',
      result.flags.length ? section('写法特征', `<div class="risk-flags">${flags}</div>`) : '',
      result.links.length ? section('链接', `<ul class="risk-list">${findings(result.links, false)}</ul>`) : '',
      result.phones.length ? section('号码', `<ul class="risk-list">${findings(result.phones, true)}</ul>`) : '',
      advice ? `<div class="risk-advice"><b>建议这样处理</b><ul>${advice}</ul></div>` : '',
      emergency,
      opts.actions || '',
      '<p class="risk-note">以上是本地规则匹配的演示结果,不能替代真实的风控与人工核验。</p>',
      '</div>'
    ].join('');
  };

  window.YL_SAFETY = { check, checkUrl, checkPhone, normalize, renderReport, RULES, PATTERNS, SAMPLES, LEVELS };
})();
