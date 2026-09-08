// SQLite 数据库初始化（better-sqlite3）
// 校园互助信息发布平台 —— 多智能体增强版
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'campus.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF'); // 演示项目关闭外键约束，避免 user_id 引用问题

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  school TEXT,
  grade TEXT,
  avatar TEXT DEFAULT '🦌',
  credit_score INTEGER DEFAULT 100,
  completed_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  reward TEXT,
  contact TEXT,
  location TEXT,
  expected_time TEXT,
  status TEXT DEFAULT 'open',
  accepted_by INTEGER,
  view_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS post_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER,
  tag TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER,
  user_id INTEGER,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dm (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER,
  receiver_id INTEGER,
  content TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  type TEXT,
  content TEXT,
  related_id INTEGER,
  read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER,
  passed INTEGER,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  role TEXT,
  content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_tags_post ON post_tags(post_id);
CREATE INDEX IF NOT EXISTS idx_dm_pair ON dm(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
`);

// ---- 公共辅助函数 ----
export function getUser(id) {
  return db.prepare('SELECT id,nickname,school,grade,avatar,credit_score,completed_count,created_at FROM users WHERE id=?').get(id);
}
export function getUserFull(id) {
  return db.prepare('SELECT id,nickname,password_hash,school,grade,avatar,credit_score,completed_count,created_at FROM users WHERE id=?').get(id);
}
export function getPostAuthor(id) {
  const r = db.prepare('SELECT user_id FROM posts WHERE id=?').get(id);
  return r ? r.user_id : null;
}
export function addNotification(userId, type, content, relatedId = null) {
  if (!userId) return;
  db.prepare('INSERT INTO notifications(user_id,type,content,related_id) VALUES (?,?,?,?)').run(userId, type, content, relatedId);
}
export function changeCredit(userId, delta) {
  db.prepare('UPDATE users SET credit_score = credit_score + ? WHERE id=?').run(delta, userId);
}
export function incCompleted(userId) {
  db.prepare('UPDATE users SET completed_count = completed_count + 1 WHERE id=?').run(userId);
}

// ---- 示例数据（仅首次）----
const count = db.prepare('SELECT COUNT(*) AS c FROM posts').get().c;
if (count === 0) {
  const h = (p) => bcrypt.hashSync(p, 8);
  const u1 = db.prepare('INSERT INTO users(nickname,password_hash,school,grade,avatar) VALUES (?,?,?,?,?)')
    .run('小鹿', h('123456'), '计算机学院', '大二', '🦌').lastInsertRowid;
  const u2 = db.prepare('INSERT INTO users(nickname,password_hash,school,grade,avatar) VALUES (?,?,?,?,?)')
    .run('阿杰', h('123456'), '软件学院', '大三', '🐯').lastInsertRowid;
  const u3 = db.prepare('INSERT INTO users(nickname,password_hash,school,grade,avatar) VALUES (?,?,?,?,?)')
    .run('学委', h('123456'), '电信学院', '大一', '🌟').lastInsertRowid;

  const mk = (uid, title, content, category, reward, contact, location, expected) => {
    const pid = db.prepare(
      'INSERT INTO posts(user_id,title,content,category,reward,contact,location,expected_time) VALUES (?,?,?,?,?,?,?,?)'
    ).run(uid, title, content, category, reward, contact, location, expected).lastInsertRowid;
    db.prepare('INSERT INTO post_tags(post_id,tag) VALUES (?,?)').run(pid, category);
    return pid;
  };

  const p1 = mk(u2, '帮忙代拿外卖到3栋', '今晚7点帮拿麦当劳到3栋楼下，报酬5元，到付即可~', '代拿', '5元', 'vx: ajie', '3栋', '今晚19:00前');
  const p2 = mk(u3, '求帮讲高数作业', '明天早八高数作业最后一题不会，求同学在主教201帮忙讲下思路，请奶茶一杯', '其他', '一杯奶茶', 'qq: xuewei', '主教201', '明天08:00');
  const p3 = mk(u1, '捡到一张校园卡', '在图书馆二楼捡到一张校园卡，姓名打码，失主私信我认领', '寻物', '—', 'vx: xiaolu', '图书馆', '尽快');
  const p4 = mk(u2, '九成新自行车转让', '毕业季出一辆变速自行车，骑行顺滑，价格好商量', '二手', '120元', 'vx: ajie', '食堂门口', '任意时间');
  const p5 = mk(u3, '组队参加程序设计校赛', '准备报名应用开发赛道，缺两个队友，会React/Node优先', '组队', '—', 'qq: xuewei', '线上', '本周内');

  db.prepare('INSERT INTO comments(post_id,user_id,content) VALUES (?,?,?)').run(p1, u1, '我可以接！几点方便？');
  db.prepare('INSERT INTO comments(post_id,user_id,content) VALUES (?,?,?)').run(p1, u2, '七点整我放楼下啦');
  db.prepare('INSERT INTO comments(post_id,user_id,content) VALUES (?,?,?)').run(p5, u1, '我会React，算我一个！');
  db.prepare('INSERT INTO audit_log(post_id,passed,reason) VALUES (?,?,?)').run(p1, 1, '通过');
  db.prepare('INSERT INTO audit_log(post_id,passed,reason) VALUES (?,?,?)').run(p2, 1, '通过');
}

// 首次启动自动追加完整演示数据（13 用户 / 27 帖 / 11 完成），
// 使“node server.js 直接跑”出来的数据与 PPT、截图一致。
const afterCount = db.prepare('SELECT COUNT(*) c FROM posts').get().c;
const afterUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (afterCount === 5 && afterUsers === 3) {
  await import('./../seed_demo.js').catch((e) => {
    console.warn('[seed] 完整演示数据扩充失败：', e.message);
  });
}

export default db;
