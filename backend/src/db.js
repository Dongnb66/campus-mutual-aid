// SQLite 数据库初始化（node:sqlite，Node 22.5+ 内置，无需任何原生编译）
// 为什么不用 better-sqlite3：它依赖原生 C++ 模块，Windows 上若无 Visual Studio C++ 工具链，
// 且预编译包下载被墙（release 资产走 objects.githubusercontent.com），npm install 必然失败。
// node:sqlite 是纯内置模块，clone 下来 npm install 只装纯 JS 依赖，开箱即跑。
// 校园互助信息发布平台 —— 多智能体增强版
//
// 双驱动（2026-09-12）：默认 SQLite（零配置可跑），DB_DRIVER=mysql 时切 MySQL/MariaDB。
// mysql2 是异步 API，而业务层全部是 node:sqlite 的同步调用——为做到「业务代码零改动」，
// src/sync_mysql.mjs 用 worker 线程 + SharedArrayBuffer/Atomics.wait 把 mysql2 桥接成
// 同步 API（语义与 node:sqlite 一致：查询期间阻塞、IO 在 worker 线程执行），
// 并在桥内翻译两处方言（INSERT OR REPLACE → REPLACE、BEGIN IMMEDIATE → START TRANSACTION）。
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomBytes, randomInt } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 默认落在 backend/campus.db；测试可用 CAMPUS_DB 指向临时库，避免污染开发数据
const DB_PATH = process.env.CAMPUS_DB || path.join(__dirname, '..', 'campus.db');

const DRIVER = (process.env.DB_DRIVER || 'sqlite').toLowerCase();
const MYSQL_URL = process.env.MYSQL_URL || 'mysql://root@127.0.0.1:3307/campus';

let db;
if (DRIVER === 'mysql') {
  try {
    const { createSyncMySQL } = await import('./sync_mysql.mjs');
    db = await createSyncMySQL(MYSQL_URL);
    console.log(`[db] 引擎 = MySQL/MariaDB（${MYSQL_URL}）`);
  } catch (e) {
    console.warn(`[db] MySQL 不可用（${e.message}），降级 SQLite`);
  }
}
if (!db) {
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = OFF;"); // 演示项目关闭外键约束，避免 user_id 引用问题
}

if (db.driver === 'mysql') {
  // MySQL/MariaDB 方言建表（MariaDB 11.4 实测；MySQL 8 需去掉 INDEX 的 IF NOT EXISTS）
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nickname VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(128) NOT NULL,
  school VARCHAR(128),
  grade VARCHAR(64),
  avatar VARCHAR(32) DEFAULT '🦌',
  credit_score INT DEFAULT 100,
  completed_count INT DEFAULT 0,
  role VARCHAR(16) DEFAULT 'student',
  is_active TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(32) NOT NULL,
  reward VARCHAR(64),
  contact VARCHAR(128),
  location VARCHAR(128),
  expected_time VARCHAR(64),
  status VARCHAR(16) DEFAULT 'open',
  accepted_by INT,
  view_count INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS post_tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT,
  tag VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT,
  user_id INT,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dm (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sender_id INT,
  receiver_id INT,
  content TEXT NOT NULL,
  \`read\` TINYINT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  type VARCHAR(32),
  content TEXT,
  related_id INT,
  \`read\` TINYINT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT,
  passed TINYINT,
  reason VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  role VARCHAR(16),
  content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at VARCHAR(40) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_identities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  provider VARCHAR(16) NOT NULL,
  external_id VARCHAR(128) NOT NULL,
  verified TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_ident UNIQUE (provider, external_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS verify_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  target VARCHAR(128) NOT NULL,
  channel VARCHAR(16) NOT NULL,
  code_hash VARCHAR(64) NOT NULL,
  scene VARCHAR(32) NOT NULL,
  expired_at BIGINT NOT NULL,
  used TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_tags_post ON post_tags(post_id);
CREATE INDEX IF NOT EXISTS idx_dm_pair ON dm(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, \`read\`);
CREATE INDEX IF NOT EXISTS idx_ident_user ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_vc_target ON verify_codes(target, scene);
`);
} else {
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
  role TEXT DEFAULT 'student',
  is_active INTEGER DEFAULT 1,
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

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_tags_post ON post_tags(post_id);
CREATE INDEX IF NOT EXISTS idx_dm_pair ON dm(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);

-- 账号身份绑定：同一用户可绑定 手机号 / 微信 / QQ
CREATE TABLE IF NOT EXISTS user_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, external_id)
);
CREATE INDEX IF NOT EXISTS idx_ident_user ON user_identities(user_id);

-- 验证码：手机号/邮箱验证（注册 / 绑定 / 第三方登录强制验证）
CREATE TABLE IF NOT EXISTS verify_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,
  channel TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  scene TEXT NOT NULL,
  expired_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vc_target ON verify_codes(target, scene);
`);
} // sqlite / mysql 建表分支结束

// ---- 公共辅助函数 ----
export function sha256(s) { return createHash('sha256').update(String(s)).digest('hex'); }

export function getUser(id) {
  return db.prepare('SELECT id,nickname,school,grade,avatar,credit_score,completed_count,role,is_active,created_at FROM users WHERE id=?').get(id);
}
export function getUserFull(id) {
  return db.prepare('SELECT id,nickname,password_hash,school,grade,avatar,credit_score,completed_count,role,is_active,created_at FROM users WHERE id=?').get(id);
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

// ---- 刷新令牌（refresh token）持久化（哈希存储，避免明文泄露）----
export function insertRefreshToken(userId, token, expiresAtMs) {
  db.prepare('INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES (?,?,?)')
    .run(userId, sha256(token), new Date(expiresAtMs).toISOString());
}
export function getRefreshTokenRow(token) {
  return db.prepare('SELECT * FROM refresh_tokens WHERE token_hash=?').get(sha256(token));
}
export function deleteRefreshToken(token) {
  db.prepare('DELETE FROM refresh_tokens WHERE token_hash=?').run(sha256(token));
}
export function deleteUserRefreshTokens(userId) {
  db.prepare('DELETE FROM refresh_tokens WHERE user_id=?').run(userId);
}
export function setUserRole(userId, role) {
  db.prepare('UPDATE users SET role=? WHERE id=?').run(role, userId);
}

// ---- 账号身份绑定（手机号 / 微信 / QQ）----
export function registerWithPhone(phone, password, nickname) {
  if (!/^1\d{10}$/.test(phone)) throw new Error('手机号格式不正确');
  if (findIdentity('phone', phone)) throw new Error('该手机号已注册');
  const hash = bcrypt.hashSync(password, 8);
  const avatars = ['🦌', '🐯', '🌟', '🐱', '🦊', '🐼', '🚀', '🍀'];
  const avatar = avatars[Math.floor(Math.random() * avatars.length)];
  const id = db.prepare('INSERT INTO users(nickname,password_hash,avatar,role) VALUES (?,?,?,?)')
    .run(nickname || `用户${phone.slice(-4)}`, hash, avatar, 'student').lastInsertRowid;
  db.prepare('INSERT INTO user_identities(user_id,provider,external_id,verified) VALUES (?,?,?,1)')
    .run(id, 'phone', phone);
  return db.prepare('SELECT id,nickname,school,grade,avatar,credit_score,completed_count,role FROM users WHERE id=?').get(id);
}
export function findIdentity(provider, externalId) {
  return db.prepare('SELECT * FROM user_identities WHERE provider=? AND external_id=?').get(provider, externalId);
}
export function bindIdentity(userId, provider, externalId) {
  const existing = db.prepare('SELECT * FROM user_identities WHERE provider=? AND external_id=?').get(provider, externalId);
  if (existing && existing.user_id !== userId) throw new Error('该账号已被其他用户绑定');
  db.prepare('INSERT OR REPLACE INTO user_identities(user_id,provider,external_id,verified) VALUES (?,?,?,1)')
    .run(userId, provider, externalId);
}
export function getIdentities(userId) {
  return db.prepare('SELECT provider,external_id,verified FROM user_identities WHERE user_id=?').all(userId);
}
export function getUserSecret(id) {
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
}

/* ============ 验证码（手机号 / 邮箱）============ */
// 只存哈希不存明文；同一 target+scene 的旧码自动作废，防止并存绕过
export function createVerifyCode(target, channel, scene, ttlMs = 5 * 60 * 1000) {
  const code = String(randomInt(100000, 999999));
  const codeHash = createHash('sha256').update(`${target}|${code}`).digest('hex');
  db.prepare('UPDATE verify_codes SET used=1 WHERE target=? AND scene=? AND used=0').run(target, scene);
  db.prepare('INSERT INTO verify_codes(target,channel,code_hash,scene,expired_at) VALUES (?,?,?,?,?)')
    .run(target, channel, codeHash, scene, Date.now() + ttlMs);
  return { code, expiredAt: Date.now() + ttlMs };
}
export function checkVerifyCode(target, code, scene) {
  const row = db.prepare(
    'SELECT id, code_hash, expired_at, used FROM verify_codes WHERE target=? AND scene=? ORDER BY id DESC LIMIT 1'
  ).get(target, scene);
  if (!row) return { ok: false, error: '请先获取验证码' };
  if (row.used) return { ok: false, error: '验证码已使用，请重新获取' };
  if (row.expired_at < Date.now()) return { ok: false, error: '验证码已过期，请重新获取' };
  const hash = createHash('sha256').update(`${target}|${String(code)}`).digest('hex');
  if (hash !== row.code_hash) return { ok: false, error: '验证码不正确' };
  db.prepare('UPDATE verify_codes SET used=1 WHERE id=?').run(row.id);
  return { ok: true };
}

// ---- 运维统计（运营维护）----
export function getOpsStats() {
  const tables = ['users', 'posts', 'post_tags', 'comments', 'dm', 'notifications', 'audit_log', 'ai_messages', 'user_identities'];
  const counts = {};
  for (const t of tables) {
    try { counts[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { counts[t] = 0; }
  }
  const last = db.prepare('SELECT created_at FROM posts ORDER BY created_at DESC LIMIT 1').get();
  const top = db.prepare('SELECT category, COUNT(*) c FROM posts GROUP BY category ORDER BY c DESC LIMIT 1').get();
  return { counts, lastActivity: last?.created_at || null, topCategory: top || null };
}

// node:sqlite 没有 better-sqlite3 的 .transaction() 帮手方法，
// 用显式 BEGIN IMMEDIATE / COMMIT / ROLLBACK 实现等价语义（回调里 return 会正常提交）。
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* 可能已回滚 */ }
    throw e;
  }
}

// 原子接单：用「UPDATE ... WHERE status='open'」做条件更新，changes===0 即说明并发下已被抢走。
// 整个判断+扣减包在一个事务里，避免「先查后改」的竞态（电商秒杀同款思路）。
export function claimPostAtomic(postId, userId) {
  return tx(() => {
    const p = db.prepare('SELECT id,user_id,status,title FROM posts WHERE id=?').get(postId);
    if (!p) return { ok: false, code: 404, error: '帖子不存在' };
    if (p.user_id === userId) return { ok: false, code: 400, error: '不能接自己的帖' };
    if (p.status !== 'open') return { ok: false, code: 400, error: '该帖已被接或已完成' };
    const res = db.prepare("UPDATE posts SET status='accepted', accepted_by=? WHERE id=? AND status='open'").run(userId, postId);
    if (res.changes === 0) return { ok: false, code: 409, error: '手慢了，该帖刚被别人接走' };
    return { ok: true, post: p };
  });
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
// 说明：传入当前 db 实例，让 seed_demo 与 db.js 用同一个库（不再各自猜路径），
//      且它不再 process.exit —— 否则会把正在启动的服务进程一起干掉。
const afterCount = db.prepare('SELECT COUNT(*) c FROM posts').get().c;
const afterUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (afterCount === 5 && afterUsers === 3) {
  try {
    const { seedDemo } = await import('./../seed_demo.js');
    const result = seedDemo(db);
    if (result && !result.skipped) {
      console.log(`[seed] 演示数据已扩充：${result.posts} 帖 / ${result.users} 用户 / 完成 ${result.completed} 单`);
    }
  } catch (e) {
    console.warn('[seed] 完整演示数据扩充失败：', e.message);
  }
}

// 兼容旧库：动态补齐新列（role / is_active），以及 refresh_tokens 表已用 IF NOT EXISTS 自动创建
function addColumnIfMissing(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`).run();
}
addColumnIfMissing('users', 'role', "TEXT DEFAULT 'student'");
addColumnIfMissing('users', 'is_active', 'INTEGER DEFAULT 1');

// 种子管理员账号（仅首次）：用于演示 RBAC 角色权限（admin 可审核/删帖/改角色）
if (!db.prepare("SELECT id FROM users WHERE role='admin'").get()) {
  db.prepare("INSERT INTO users(nickname,password_hash,school,grade,avatar,role) VALUES (?,?,?,?,?,?)")
    .run('admin', bcrypt.hashSync('admin123', 8), '平台', '运营', '🛡️', 'admin');
  console.log('[seed] 已创建管理员账号 admin / admin123（请及时修改密码）');
}

export default db;
