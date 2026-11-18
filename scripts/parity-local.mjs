// parity-local.mjs —— 公网 playground 算法 vs 本地完整版 backend 的逐值对拍。
// 用法：node scripts/parity-local.mjs <本地backend目录>
// 本地侧强制无模型 Key + fetch 抛错 → 走规则兜底（与公网版同路径）；
// 临时库自动铺种子后，把 created_at 对齐 playground 的固定时间戳，再比检索 / 撮合 / 信用。
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';

const backendDir = process.argv[2];
if (!backendDir) { console.error('用法: node scripts/parity-local.mjs <本地backend目录>'); process.exit(2); }

const TMP_DB = path.join(os.tmpdir(), `campus-parity-${Date.now()}.db`);
process.env.CAMPUS_DB = TMP_DB;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.DB_DRIVER;
globalThis.fetch = () => { throw new Error('对拍强制规则兜底：不允许模型请求'); };

const local = await import(pathToFileURL(path.join(backendDir, 'src', 'agents.js')).href);
const dbmod = await import(pathToFileURL(path.join(backendDir, 'src', 'db.js')).href);
const db = dbmod.default;

const pgDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'playground', 'functions');
const core = await import(pathToFileURL(path.join(pgDir, 'core.mjs')).href);
const seed = await import(pathToFileURL(path.join(pgDir, 'seed.mjs')).href);

let pass = 0;
function ok(name) { pass++; console.log('  ok -', name); }

// ---- 1. 规则函数：路由 / 引导 / 审核，多组输入逐值一致 ----
const TEXTS = [
  '帮我代拿个快递到3栋', '哪里有二手的自行车', '这个平台怎么用', '今天天气不错',
  '明天下午帮我去图书馆拿个快递，微信 abc123，请你喝奶茶', '求个二手自行车',
  '招代考枪手，包过，加微信 abc123', '刷单日结300，加vx报名', '专业代办证件发票，联系qq',
  '求帮忙代拿外卖到3栋，报酬5元', '组队参加程序设计校赛，缺两个队友',
  '今晚帮拿麦当劳到3栋楼下，报酬5元，vx: ajie', '丢失校园卡一张，食堂丢的，重谢',
];
for (const t of TEXTS) {
  assert.deepEqual(await local.routeIntent(t), core.routeIntentRule(t), 'route: ' + t);
  assert.deepEqual(await local.guidePost(t), core.guidePostRule(t), 'guide: ' + t);
}
ok(`Router/Post 规则兜底 ${TEXTS.length} 组输入逐值一致`);
for (const t of TEXTS) {
  assert.deepEqual(await local.auditPost(t), core.auditPostRule(t), 'audit: ' + t);
}
ok(`Audit 黑名单 ${TEXTS.length} 组输入逐值一致`);

// ---- 2. 种子同源：本地自动铺库后的用户信用 / 完成数 == playground 种子 ----
for (const u of seed.SEED_USERS) {
  if (u.role === 'admin') continue;
  const row = db.prepare('SELECT nickname,credit_score,completed_count FROM users WHERE id=?').get(u.id);
  assert.equal(row.nickname, u.nickname);
  assert.equal(row.credit_score, u.credit_score, `credit ${u.nickname}`);
  assert.equal(row.completed_count, u.completed_count, `completed ${u.nickname}`);
}
ok('13 用户信用分 / 完成数与本地 seed_demo 累加结果逐值一致');

// ---- 3. 时间戳对齐后：检索 / 撮合逐值一致 ----
for (const p of seed.SEED_POSTS) {
  db.prepare('UPDATE posts SET created_at=? WHERE id=?').run(p.created_at, p.id);
}
const QUERIES = ['代拿外卖', '图书馆', '二手自行车', '组队', '奶茶', "'; DROP TABLE posts;--", '快递'];
for (const q of QUERIES) {
  const l = (await local.searchPosts(q)).map((r) => ({ id: r.id, title: r.title, category: r.category, reward: r.reward, status: r.status, author: r.author, author_credit: r.author_credit }));
  const p = core.searchPostsRule(q).map((r) => ({ id: r.id, title: r.title, category: r.category, reward: r.reward, status: r.status, author: r.author, author_credit: r.author_credit }));
  assert.deepEqual(l, p, 'search: ' + q);
}
ok(`Search 检索 ${QUERIES.length} 组查询逐值一致（含注入字符串）`);

for (const uid of [1, 2, 3, 5]) {
  const l = (await local.matchPosts({ id: uid }, 8)).map((r) => ({ id: r.id, score: r.score }));
  const p = core.matchPostsRule({ id: uid }, seed.SEED_POSTS, 8, Date.now()).map((r) => ({ id: r.id, score: r.score }));
  assert.deepEqual(l, p, 'match user ' + uid);
}
ok('Match 撮合 4 个用户 × top8 的 id 与 score 逐值一致（同权重）');

// ---- 4. 达人榜口径 ----
const lTop = db.prepare('SELECT id,nickname,credit_score,completed_count FROM users ORDER BY completed_count DESC, credit_score DESC LIMIT 8').all()
  .map((r) => ({ id: r.id, nickname: r.nickname, credit_score: r.credit_score, completed_count: r.completed_count }));
const pTop = seed.SEED_USERS.slice().sort((a, b) => b.completed_count - a.completed_count || b.credit_score - a.credit_score).slice(0, 8)
  .map(({ id, nickname, credit_score, completed_count }) => ({ id, nickname, credit_score, completed_count }));
assert.deepEqual(lTop, pTop);
ok('达人榜 top8 逐值一致');

try { fs.rmSync(TMP_DB, { force: true }); fs.rmSync(TMP_DB + '-wal', { force: true }); fs.rmSync(TMP_DB + '-shm', { force: true }); } catch {}
console.log(`\n同源对拍通过：${pass} 组`);
process.exit(0);