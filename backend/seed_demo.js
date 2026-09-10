// 一次性演示数据扩充脚本（幂等：仅在原始 3 用户基础上运行一次）
// 目的：让平台数据看板 / 广场 / 达人榜 看起来像一个真实运营的校园互助社区，
// 服务于参赛答辩 demo 与截图。
//
// 用法：
//   node seed_demo.js        <- 直接执行，自动检测并扩充
//   import { seedDemo }      <- 作为模块被 db.js 调用（首次启动自动铺数据）
//
// 注意（历史 bug 修复）：
//   1. 数据库路径改为读 CAMPUS_DB，与 src/db.js 保持一致。此前这里硬编码
//      campus.db，导致 CAMPUS_DB 指向别的库时，会去数另一个库的用户数、
//      并往错误的库写数据。
//   2. 不再调用 process.exit(0)。本文件会被 src/db.js 以 `await import()`
//      的方式加载，库里有数据时直接 process.exit(0) 会把**正在启动的服务进程**
//      一起干掉（表现为：服务起来后立刻退出、没有任何报错）。
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = process.env.CAMPUS_DB || path.join(__dirname, 'campus.db');

const defaultDb = new Database(DEFAULT_DB_PATH);

/**
 * 幂等扩充演示数据。
 * @param {import('better-sqlite3').Database} [db] 目标库，默认 backend/campus.db（或 CAMPUS_DB）
 * @returns {{skipped:true,existing:number}|{skipped:false,users:number,posts:number,completed:number}}
 */
export function seedDemo(db = defaultDb) {
  const existing = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (existing > 3) {
    console.log(`已存在 ${existing} 个用户，跳过扩充（幂等保护）。如需重建，请先删除 campus.db。`);
    return { skipped: true, existing };
  }

  const h = (p) => bcrypt.hashSync(p, 8);
  const insertUser = db.prepare('INSERT INTO users(nickname,password_hash,school,grade,avatar) VALUES (?,?,?,?,?)');
  const insertPost = db.prepare(
    'INSERT INTO posts(user_id,title,content,category,reward,contact,location,expected_time,status,accepted_by,view_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  );
  const insertTag = db.prepare('INSERT INTO post_tags(post_id,tag) VALUES (?,?)');
  const insertComment = db.prepare('INSERT INTO comments(post_id,user_id,content) VALUES (?,?,?)');
  const insertDm = db.prepare('INSERT INTO dm(sender_id,receiver_id,content,read) VALUES (?,?,?,?)');
  const insertNotif = db.prepare('INSERT INTO notifications(user_id,type,content,related_id,read) VALUES (?,?,?,?,?)');
  const insertAudit = db.prepare('INSERT INTO audit_log(post_id,passed,reason) VALUES (?,?,?)');
  const setUser = db.prepare('UPDATE users SET credit_score=?, completed_count=? WHERE id=?');

  // ---- 新增用户 ----
  const newUsers = [
    ['小美', '文学院', '大一', '🌸'], ['大壮', '体育学院', '大二', '💪'],
    ['学长', '计算机学院', '大三', '🎓'], ['团团', '艺术学院', '大一', '🐰'],
    ['阿强', '机械学院', '大二', '🐻'], ['雪儿', '外语学院', '大二', '❄️'],
    ['老李', '商学院', '大四', '🧔'], ['萌萌', '教育学院', '大一', '🐱'],
    ['阿伟', '计算机学院', '大二', '🤖'], ['娜娜', '医学院', '大三', '🌟'],
  ];
  const uids = newUsers.map(([n, s, g, a]) => insertUser.run(n, h('123456'), s, g, a).lastInsertRowid);
  // 原始 3 个用户 id 为 1,2,3
  const all = [1, 2, 3, ...uids];

  // 信用 / 完成数累加器
  const credit = {}, done = {};
  all.forEach(id => { credit[id] = 100; done[id] = 0; });

  // ---- 帖子模板： [authorIdx, title, content, category, reward, contact, location, expected, status, acceptorIdx|null, views] ----
  // authorIdx / acceptorIdx 指向 all 数组下标（0=小鹿,1=阿杰,2=学委,3=小美,...）
  const posts = [
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

  const comments = [
    [0, 3, '我来帮你拿！'], [1, 4, '几点方便讲题？'], [2, 5, '耳机是我的，怎么联系？'],
    [5, 7, '我帮你搬，加微信'], [8, 2, '资料还要吗？'],
  ];

  const dms = [
    [3, 7, '搬寝室的事我接了哈', 1], [7, 3, '好的，周六上午九点楼下见', 1],
    [4, 0, '蓝屏的问题我看看，远程还是现场？', 1], [0, 4, '现场吧，在宿舍', 0],
    [2, 9, '学生证已确认，来认领', 1],
  ];

  const pid = [];
  for (const p of posts) {
    const [ai, title, content, cat, reward, contact, loc, exp, status, accIdx, views] = p;
    const authorId = all[ai];
    const accId = accIdx != null ? all[accIdx] : null;
    const id = insertPost.run(authorId, title, content, cat, reward, contact, loc, exp, status, accId, views).lastInsertRowid;
    insertTag.run(id, cat);
    insertAudit.run(id, 1, 'AI审核通过');
    pid.push(id);
    if (status === 'completed' && accId) {
      done[accId] += 1; credit[accId] += 5;
      credit[authorId] += 2;
      insertNotif.run(accId, 'complete', `互助已完成：「${title}」，信用 +5`, id, 1);
      insertNotif.run(authorId, 'complete', `互助已完成：「${title}」，信用 +2`, id, 1);
    } else if (status === 'accepted' && accId) {
      insertNotif.run(authorId, 'accept', `你的互助帖「${title}」已被接单，请保持联系`, id, 0);
    }
  }

  // 评论与私信（引用有效 id）
  for (const [pi, ui, text] of comments) insertComment.run(pid[pi], all[ui], text);
  for (const [si, ri, text, read] of dms) insertDm.run(all[si], all[ri], text, read);

  // 写回信用与完成数
  all.forEach(id => setUser.run(credit[id], done[id], id));

  const completed = Object.values(done).reduce((a, b) => a + b, 0);
  console.log(`扩充完成：${all.length} 个用户，${posts.length} 条帖子，已完成 ${completed} 单互助。`);
  return { skipped: false, users: all.length, posts: posts.length, completed };
}

// 仅在被直接执行时自动运行；被 import 时由调用方决定（避免副作用）
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) seedDemo();

export default defaultDb;
