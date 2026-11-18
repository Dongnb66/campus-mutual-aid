// seed.mjs —— 公开演示版的捆绑种子数据（只读）。
// 数据来源：本地完整版 backend/src/db.js 的初始 3 用户 / 5 帖 + backend/seed_demo.js
// 的 10 用户 / 22 帖扩充，逐条同源搬运；信用分 / 完成数按同一规则累加：
//   每笔 completed：接单人 credit +5、completed_count +1；发帖人 credit +2。
// 公网版不写库：本文件是公开榜的唯一数据源，交互演示走 handler 的 preview 无状态重算。
// created_at 固定为 2026-11-01 起的等差时间戳（全部早于发布日 60 小时以上），
// 保证撮合打分里种子帖的新鲜度分量恒为 0，本地 / 线上逐值对拍可复现。

export const CATEGORIES = ['代拿', '接课', '寻物', '二手', '组队', '其他'];

// [nickname, school, grade]（avatar 在公网版用昵称首字渲染，不搬 emoji）
const BASE_USERS = [
  ['小鹿', '计算机学院', '大二'],
  ['阿杰', '软件学院', '大三'],
  ['学委', '电信学院', '大一'],
];
const EXTRA_USERS = [
  ['小美', '文学院', '大一'], ['大壮', '体育学院', '大二'],
  ['学长', '计算机学院', '大三'], ['团团', '艺术学院', '大一'],
  ['阿强', '机械学院', '大二'], ['雪儿', '外语学院', '大二'],
  ['老李', '商学院', '大四'], ['萌萌', '教育学院', '大一'],
  ['阿伟', '计算机学院', '大二'], ['娜娜', '医学院', '大三'],
];

const T0 = Date.parse('2026-11-01T08:00:00.000Z');
const STEP_MS = 37 * 60 * 1000;
const ts = (i) => new Date(T0 + i * STEP_MS).toISOString();

// 初始 5 帖（db.js 首次启动铺底），作者 id：p1/p4=2 阿杰，p2/p5=3 学委，p3=1 小鹿
// [user_id, title, content, category, reward, contact, location, expected_time]
const BASE_POSTS = [
  [2, '帮忙代拿外卖到3栋', '今晚7点帮拿麦当劳到3栋楼下，报酬5元，到付即可~', '代拿', '5元', 'vx: ajie', '3栋', '今晚19:00前'],
  [3, '求帮讲高数作业', '明天早八高数作业最后一题不会，求同学在主教201帮忙讲下思路，请奶茶一杯', '其他', '一杯奶茶', 'qq: xuewei', '主教201', '明天08:00'],
  [1, '捡到一张校园卡', '在图书馆二楼捡到一张校园卡，姓名打码，失主私信我认领', '寻物', '—', 'vx: xiaolu', '图书馆', '尽快'],
  [2, '九成新自行车转让', '毕业季出一辆变速自行车，骑行顺滑，价格好商量', '二手', '120元', 'vx: ajie', '食堂门口', '任意时间'],
  [3, '组队参加程序设计校赛', '准备报名应用开发赛道，缺两个队友，会React/Node优先', '组队', '—', 'qq: xuewei', '线上', '本周内'],
];

// seed_demo.js 的 22 帖模板：
// [authorIdx, title, content, category, reward, contact, location, expected, status, acceptorIdx|null, views]
// authorIdx / acceptorIdx 指向 all 数组下标（0=小鹿,1=阿杰,2=学委,3=小美,...）
const EXTRA_POSTS = [
  [1, '帮忙代拿快递到5栋', '顺丰柜在菜鸟驿站，帮我拿回来放5栋前台，报酬3元', '代拿', '3元', 'vx: ajie', '5栋', '今天', 'completed', 3, 42],
  [2, '求搭子练英语口语', '明天早八英语角想找同学一起练口语，主教305，求搭子，请咖啡', '组队', '一杯咖啡', 'qq: xuewei', '主教305', '明天08:00', 'completed', 4, 38],
  [0, '捡到一副蓝牙耳机', '在图书馆三楼捡到白色蓝牙耳机，失主速来认领', '寻物', '—', 'vx: xiaolu', '图书馆', '尽快', 'completed', 5, 56],
  [1, '九成新山地车转让', '毕业季出一辆变速山地车，骑行顺滑，价格好商量', '二手', '150元', 'vx: ajie', '食堂门口', '任意', 'open', null, 21],
  [2, '组队打数学建模校赛', '准备报名数学建模，缺一个会MATLAB的队友', '组队', '—', 'qq: xuewei', '线上', '本周', 'completed', 6, 33],
  [3, '帮忙搬寝室到7栋', '东西不多，一个行李箱加两袋书，从3栋搬到7栋', '代拿', '5元', 'vx: xiaomei', '7栋', '周六', 'accepted', 7, 19],
  [4, '求带晚自习资料', '今晚在二教102自习，想借同学近代史笔记看一下重点，奶茶答谢', '其他', '奶茶', 'vx: xuezhang', '二教102', '今晚19:30', 'open', null, 27],
  [5, '丢失校园卡一张', '中午在食堂丢的，姓名已模糊，拾到请联系', '寻物', '重谢', 'vx: aqiang', '食堂', '尽快', 'completed', 8, 48],
  [6, '出九成新考研资料', '政治英语数学全套笔记，几乎全新，低价出', '二手', '60元', 'vx: laoli', '图书馆', '任意', 'open', null, 15],
  [7, '组队开发小程序比赛', '想做一个校园二手交易小程序，会前端即可', '组队', '—', 'vx: mengmeng', '线上', '两周内', 'accepted', 9, 24],
  [0, '帮忙取外卖到宿舍', '美团订单，放3栋楼下架子即可，到付', '代拿', '2元', 'vx: xiaolu', '3栋', '12:30前', 'completed', 1, 51],
  [8, '求讲物理实验报告', '下周物理实验报告数据不会处理，求同学在理科楼帮忙讲一下，饮料答谢', '其他', '饮料', 'vx: awei', '理科楼', '下周一', 'open', null, 12],
  [9, '捡到学生证', '在操场捡到一张学生证，姓名打码，失主认领', '寻物', '—', 'vx: nana', '操场', '尽快', 'completed', 2, 44],
  [3, '出考研数学真题卷', '近十年数二真题及解析，字迹清晰', '二手', '20元', 'vx: xiaomei', '自习室', '任意', 'completed', 10, 36],
  [4, '帮忙修电脑蓝屏', '笔记本开机蓝屏，求懂电脑的同学帮忙看看', '其他', '20元', 'vx: xuezhang', '宿舍', '今晚', 'accepted', 0, 29],
  [5, '组队参加英语演讲', '想报名英语演讲比赛，缺一个搭档', '组队', '—', 'vx: aqiang', '外语楼', '本月', 'open', null, 17],
  [6, '代拿药房买药', '帮我到校医院药房取药，报酬5元', '代拿', '5元', 'vx: laoli', '校医院', '下午', 'completed', 3, 39],
  [7, '求借笔记一周', '近代史笔记求借，下周考试用，必还', '其他', '—', 'vx: mengmeng', '线上', '一周', 'open', null, 9],
  [8, '出二手自行车', '骑行两年，保养好，适合代步', '二手', '90元', 'vx: awei', '东门', '任意', 'completed', 4, 31],
  [9, '帮忙拍作业照片', '帮我在实训楼拍几张设备照片，用于作业', '其他', '奶茶', 'vx: nana', '实训楼', '明天', 'open', null, 14],
  [1, '组队做数据库课设', '数据库大作业，缺一个写后端的，会Node优先', '组队', '—', 'vx: ajie', '线上', '三周内', 'completed', 8, 26],
  [2, '捡到雨伞一把', '下雨天在教室捡到一把黑伞，失主认领', '寻物', '—', 'qq: xuewei', '教室', '尽快', 'open', null, 22],
];

const ALL_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

// ---- 组装 users（信用 / 完成数按 completed 帖累加，与 seed_demo.js 同规则）----
const credit = {};
const done = {};
ALL_IDS.forEach((id) => { credit[id] = 100; done[id] = 0; });

export const SEED_POSTS = [];
let pid = 0;
for (const [uid, title, content, category, reward, contact, location, expected] of BASE_POSTS) {
  pid += 1;
  SEED_POSTS.push({
    id: pid, user_id: uid, title, content, category, reward, contact, location,
    expected_time: expected, status: 'open', accepted_by: null, view_count: 0,
    created_at: ts(pid - 1), tags: [category],
  });
}
for (const [ai, title, content, category, reward, contact, location, expected, status, accIdx, views] of EXTRA_POSTS) {
  pid += 1;
  const authorId = ALL_IDS[ai];
  const accId = accIdx != null ? ALL_IDS[accIdx] : null;
  SEED_POSTS.push({
    id: pid, user_id: authorId, title, content, category, reward, contact, location,
    expected_time: expected, status, accepted_by: accId, view_count: views,
    created_at: ts(pid - 1), tags: [category],
  });
  if (status === 'completed' && accId) {
    done[accId] += 1; credit[accId] += 5;
    credit[authorId] += 2;
  }
}

export const SEED_USERS = [...BASE_USERS, ...EXTRA_USERS].map(([nickname, school, grade], i) => ({
  id: i + 1, nickname, school, grade,
  credit_score: credit[i + 1], completed_count: done[i + 1], role: 'student',
}));
// 本地完整版 db.js 会补一个种子管理员（RBAC 演示用），公开榜同样计入统计口径
SEED_USERS.push({ id: 14, nickname: 'admin', school: '平台', grade: '运营', credit_score: 100, completed_count: 0, role: 'admin' });

// 评论（初始 3 条 + seed_demo 5 条，pi 为 EXTRA_POSTS 下标）
export const SEED_COMMENTS = [
  { post_id: 1, user_id: 1, content: '我可以接！几点方便？' },
  { post_id: 1, user_id: 2, content: '七点整我放楼下啦' },
  { post_id: 5, user_id: 1, content: '我会React，算我一个！' },
  { post_id: 6, user_id: 4, content: '我来帮你拿！' },
  { post_id: 7, user_id: 5, content: '几点方便讲题？' },
  { post_id: 8, user_id: 6, content: '耳机是我的，怎么联系？' },
  { post_id: 11, user_id: 8, content: '我帮你搬，加微信' },
  { post_id: 14, user_id: 3, content: '资料还要吗？' },
];

export const SEED_DM_COUNT = 5; // seed_demo.js 的 5 条私信（内容不公开，仅统计口径）

// ---- 审核开/关对照样本（内置违规示例，只用于「审核对照」演示，不进公开榜）----
// 与真实种子帖严格隔离：id 99001+、compare=true；公开榜 /api/posts 与撮合候选都不含它们。
// 用途：审核开 → 被黑名单拦截并留痕；审核关 → 会混进榜单，直观展示审核智能体的价值。
export const COMPARE_POSTS = [
  {
    id: 99001, user_id: 99001, title: '招代考枪手，包过', content: '招代考枪手，高数期末包过，价格私聊，加微信 abc123',
    category: '其他', reward: '面议', contact: 'abc123', location: '线上', expected_time: '本周',
    status: 'open', accepted_by: null, view_count: 0, created_at: ts(27), tags: ['其他'],
    author: '对照样本A', author_credit: 100, demo: true, compare: true,
  },
  {
    id: 99002, user_id: 99002, title: '刷单日结300', content: '刷单日结300，动动手指就赚钱，加vx报名，学生优先',
    category: '其他', reward: '300元', contact: '', location: '线上', expected_time: '随时',
    status: 'open', accepted_by: null, view_count: 0, created_at: ts(28), tags: ['其他'],
    author: '对照样本B', author_credit: 100, demo: true, compare: true,
  },
];

export const userById = (id) => SEED_USERS.find((u) => u.id === id) || null;

// 帖子 + 作者信息视图（与本地 postView / 列表接口同口径）。
// 演示帖（浏览器本地身份）自带 author / author_credit，直接保留。
export function withAuthor(p) {
  if (p.author != null) return { ...p };
  const u = userById(p.user_id);
  return {
    ...p,
    author: u ? u.nickname : null,
    author_credit: u ? u.credit_score : null,
    author_grade: u ? u.grade : null,
  };
}