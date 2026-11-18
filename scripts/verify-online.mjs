// verify-online.mjs —— 线上产物全路由验证 + 业务断言 + 与本地 handler 逐值对拍。
// 用法：node scripts/verify-online.mjs <站点URL> [下载目录]
// 双模式自适应（读首页 cma-mode 标记）：
//   edge  ：真实 HTTP 请求 /functions/v1/app/api/*（边缘函数 Deno.serve(handler)）；
//   static：后端配额满时的发布兜底——线上 /lib/*.mjs 即线上产物，下载后在 Node 24 里
//           直接调同一份 handler（浏览器内执行的就是它），先做 SHA256 逐字节同源校验。
// 两种模式都跑同一套「全路由状态码 + 业务语义断言 + 线上/本地逐值 deepEqual」。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const SITE = (process.argv[2] || '').replace(/\/+$/, '');
const DL = process.argv[3];
if (!SITE) { console.error('用法: node scripts/verify-online.mjs <站点URL> [下载目录]'); process.exit(2); }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const repoFn = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'playground', 'functions');
const local = (await import(pathToFileURL(path.join(repoFn, 'handler.mjs')).href)).handler;
const BASE = 'https://campus-mutual-aid.example';
const NOW = Date.parse('2026-11-17T00:00:00.000Z');
const me = { id: 90001, nickname: '张三', credit: 100 };
const peer = { id: 90002, nickname: '李四', credit: 100 };
const demo = [{ title: '帮忙代拿快递到9栋', content: '帮忙代拿快递到9栋，报酬5元', category: '代拿', reward: '5元', created_at_ms: NOW, user_id: 90001, author: '张三', author_credit: 100 }];

let checks = 0;
const ok = (name) => { checks++; console.log('ok -', name); };
const sha = (s) => createHash('sha256').update(s).digest('hex');

// ---- 0. 首页与模式 ----
const home = await fetch(SITE + '/', { headers: { 'User-Agent': UA } });
assert.equal(home.status, 200);
const html = await home.text();
assert.ok(html.includes('校园互助平台'));
assert.ok(html.includes('HACK4GOOD'));
const mode = (html.match(/name="cma-mode" content="(edge|static)"/) || [])[1];
assert.ok(mode, '首页必须带 cma-mode 标记');
ok(`首页 200，含产品标题 / 赛道标识 / cma-mode=${mode}`);

// ---- 1. 传输层：edge 走真实 HTTP；static 走线上产物模块 ----
let pair;
if (mode === 'edge') {
  pair = async (method, p, body) => {
    const headers = { 'User-Agent': UA, Origin: SITE, Referer: SITE + '/' };
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    const ro = await fetch(SITE + '/functions/v1/app' + p, { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });
    const rl = await local({
      request: new Request(BASE + p, method === 'POST'
        ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method }),
      env: {},
    });
    assert.equal(ro.status, rl.status, p + ' 状态码');
    const bo = await ro.json(), bl = await rl.json();
    assert.deepEqual(bo, bl, p + ' ' + JSON.stringify(body || {}));
    return { status: ro.status, body: bo };
  };
} else {
  assert.ok(DL, 'static 模式需要下载目录参数');
  fs.mkdirSync(DL, { recursive: true });
  for (const m of ['handler.mjs', 'core.mjs', 'seed.mjs']) {
    const r = await fetch(SITE + '/lib/' + m, { headers: { 'User-Agent': UA } });
    assert.equal(r.status, 200, '/lib/' + m + ' 必须 200');
    const text = await r.text();
    fs.writeFileSync(path.join(DL, m), text);
    assert.equal(sha(text), sha(fs.readFileSync(path.join(repoFn, m), 'utf8')), m + ' 线上产物与仓库源码 SHA256 一致');
  }
  ok('static：线上 /lib/handler|core|seed 三模块 200 且与仓库源码 SHA256 逐字节一致');
  const online = (await import(pathToFileURL(path.join(DL, 'handler.mjs')).href)).handler;
  pair = async (method, p, body) => {
    const mk = () => new Request(BASE + p, method === 'POST'
      ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method });
    const ro = await online({ request: mk(), env: {} });
    const rl = await local({ request: mk(), env: {} });
    assert.equal(ro.status, rl.status, p + ' 状态码');
    const bo = await ro.json(), bl = await rl.json();
    assert.deepEqual(bo, bl, p + ' ' + JSON.stringify(body || {}));
    return { status: ro.status, body: bo };
  };
}

// ---- 2. 全路由状态码 + 逐值对拍 ----
const GETS = ['/api/health', '/api/stats', '/api/posts', '/api/posts?category=%E4%BB%A3%E6%8B%BF', '/api/posts?q=%E5%BF%AB%E9%80%92', '/api/top-helpers', '/api/rules', '/api/categories', '/api/users/4', '/api/fsm'];
for (const p of GETS) {
  const r = await pair('GET', p);
  assert.equal(r.status, 200, p + ' 必须 200');
}
ok(`${GETS.length} 个 GET 业务路由 200 且线上/本地逐值一致`);
assert.equal((await pair('GET', '/api/nope')).status, 404);
assert.equal((await pair('GET', '/api/users/99999')).status, 404);
ok('未知路由 / 不存在用户正确 404（不全返回成功）');

const POSTS = [
  ...['帮我代拿个快递到3栋', '哪里有二手的自行车', '这个平台怎么用', '今天天气不错'].map((text) => ({ action: 'route', text })),
  { action: 'guide', text: '明天下午帮我去图书馆拿个快递，微信 abc123，请你喝奶茶' },
  { action: 'guide', text: '求个二手自行车' },
  ...['招代考枪手，包过，加微信 abc123', '刷单日结300，加vx报名', '专业代办证件发票，联系qq', '求帮忙代拿外卖到3栋，报酬5元', '组队参加程序设计校赛，缺两个队友'].map((text) => ({ action: 'audit', text })),
  { action: 'search', query: '代拿外卖', user: me, demoPosts: demo },
  { action: 'search', query: '图书馆' },
  { action: 'search', query: "'; DROP TABLE posts;--" },
  { action: 'match', user: me, demoPosts: demo, limit: 8, now: NOW },
  { action: 'match', user: peer, demoPosts: demo, limit: 8, now: NOW },
  { action: 'match', user: me, limit: 3, now: NOW },
  { action: 'claim', postId: 1, user: me, mode: 'race', secondUserId: 90002 },
  { action: 'claim', postId: 1, user: me },
  { action: 'claim', postId: 3, userId: 1 },
  { action: 'claim', postId: 6, userId: 90001 },
  { action: 'claim', postId: 99999, userId: 90001 },
  { action: 'complete', postId: 11 },
  { action: 'complete', postId: 1 },
  { action: 'publish', text: '明天下午帮我去图书馆拿个快递，微信 abc123，请你喝奶茶', user: me, now: NOW },
  { action: 'publish', text: '招代考枪手，包过，加微信 abc123', user: me, now: NOW },
  { action: 'pipeline', text: '明天下午帮我去图书馆拿个快递，微信 abc123，请你喝奶茶', user: me, demoPosts: demo, now: NOW },
  { action: 'pipeline', text: '招代考枪手，包过，加微信 abc123', user: me, now: NOW },
  { action: 'board', audit: 'on' },
  { action: 'board', audit: 'off' },
  { action: 'fsm', state: 'open', event: 'claim', authorId: 2, actorId: 90001 },
  { action: 'fsm', state: 'claimed', event: 'claim', authorId: 2, actorId: 90002, acceptedBy: 90001 },
  { action: 'fsm', state: 'open', event: 'complete', authorId: 2, actorId: 90001 },
  { action: 'fsm', state: 'claimed', event: 'complete', authorId: 2, actorId: 90001, acceptedBy: 90001 },
  { action: 'fsm', state: 'claimed', event: 'timeout', authorId: 2, actorId: 90001, acceptedBy: 90001, overdue: true },
  { action: 'fsmRace', authorId: 2, firstUserId: 90001, secondUserId: 90002 },
  { action: 'nope' },
  { action: 'match', user: { id: 1, nickname: 'x' } },
];
const biz = {};
for (const body of POSTS) {
  const r = await pair('POST', '/api/preview', body);
  const key = body.action + (body.mode ? ':' + body.mode : '') + (body.postId != null ? ':' + body.postId : '') + (body.audit ? ':' + body.audit : '') + (body.state ? ':' + body.state : '') + (body.event ? ':' + body.event : '');
  biz[key] = r;
}
ok(`${POSTS.length} 个 preview 请求线上/本地逐值一致（含 board 对照 / 守卫 400）`);

// ---- 3. 线上值独立业务断言 ----
const health = (await pair('GET', '/api/health')).body;
assert.equal(health.mode, 'preview');
assert.equal(health.agents, 5);
assert.deepEqual(health.seed, { users: 14, posts: 27 });
const stats = (await pair('GET', '/api/stats')).body;
assert.equal(stats.users, 14); assert.equal(stats.posts, 27);
assert.equal(stats.open, 13); assert.equal(stats.accepted, 3); assert.equal(stats.completed, 11);
ok('health/stats：preview 模式 / 5 智能体 / 14 用户 27 帖 13 可接 3 进行中 11 完成');

const race = biz['claim:race:1'].body;
assert.equal(race.results[0].ok, true);
assert.equal(race.results[0].affectedRows, 1);
assert.equal(race.results[1].ok, false);
assert.equal(race.results[1].code, 409);
assert.equal(race.results[1].affectedRows, 0);
assert.match(race.results[0].sql, /WHERE id=\? AND status='open'/);
ok('并发接单：受影响行数=1 抢到 / =0 已被抢 409（条件更新语义）');

assert.equal(biz['claim:1'].body.results[0].ok, true);
assert.equal(biz['claim:1'].body.results[1].code, 400);
assert.equal(biz['claim:3'].body.results[0].code, 400);
assert.equal(biz['claim:99999'].body.results[0].code, 404);
ok('接单边界：顺序第二 400 / 自己的帖 400 / 不存在 404');

const comp = biz['complete:11'].body;
assert.equal(comp.helper.delta, 5);
assert.equal(comp.author.delta, 2);
assert.equal(comp.helper.after, comp.helper.before + 5);
assert.equal(comp.author.after, comp.author.before + 2);
ok('完成互助：接单 +5 / 发帖 +2（信用分规则）');

const peerRes = await pair('POST', '/api/preview', { action: 'match', user: peer, demoPosts: demo, limit: 8, now: NOW });
const top = peerRes.body.results;
assert.ok(top.some((p) => p.demo && p.parts.fresh > 4.9), '同学视角应看到新鲜度≈5 的演示帖');
for (const p of top) {
  const expect = Math.round((p.parts.pref + p.parts.reward + p.parts.credit + p.parts.fresh) * 10) / 10;
  assert.equal(p.score, expect, 'score 必须等于四因子之和');
  assert.ok(p.evidence && p.evidence.notes.length === 4, '每条撮合带四因子证据锚点');
}
ok('撮合：score=四因子之和，演示帖新鲜度≈5，每条带证据锚点');

const badRes = await pair('POST', '/api/preview', { action: 'audit', text: '招代考枪手，包过，加微信 abc123' });
assert.equal(badRes.body.passed, false);
assert.ok(badRes.body.hits.length > 0);
assert.equal('招代考枪手，包过，加微信 abc123'.slice(badRes.body.hits[0].start, badRes.body.hits[0].end), badRes.body.hits[0].word);
ok('审核：违规拦截 + 命中词字符区间证据');

const boardOn = biz['board:on'].body;
const boardOff = biz['board:off'].body;
assert.equal(boardOn.passedCount, 27);
assert.equal(boardOn.blocked.length, 2);
assert.deepEqual(boardOn.blocked.map((b) => b.id).sort(), [99001, 99002]);
assert.equal(boardOff.rows.length, 29);
assert.equal(boardOff.rows.filter((p) => p.compare).length, 2);
ok('审核开/关对照：开 27 进榜 2 拦截留痕 / 关 29 含违规样本');

const fsmDef = (await pair('GET', '/api/fsm')).body;
assert.equal(fsmDef.states.length, 5);
assert.equal(fsmDef.transitions.length, 5);
const fsmOk = biz['fsm:open:claim'].body;
assert.equal(fsmOk.ok, true); assert.equal(fsmOk.affectedRows, 1); assert.equal(fsmOk.to, 'claimed');
assert.match(fsmOk.sql, /WHERE id=\? AND status='open'/);
const fsmGuard = biz['fsm:claimed:claim'].body;
assert.equal(fsmGuard.ok, false); assert.equal(fsmGuard.code, 409); assert.equal(fsmGuard.affectedRows, 0);
const fsmIllegal = biz['fsm:open:complete'].body;
assert.equal(fsmIllegal.illegal, true); assert.equal(fsmIllegal.affectedRows, 0);
assert.deepEqual(biz['fsm:claimed:complete'].body.credit, { helper: 5, author: 2 });
assert.equal(biz['fsm:claimed:timeout'].body.credit.helper, -3);
const fsmRaceB = biz['fsmRace'].body;
assert.equal(fsmRaceB.results[0].affectedRows, 1);
assert.equal(fsmRaceB.results[1].affectedRows, 0);
assert.equal(fsmRaceB.results[1].code, 409);
assert.equal(fsmRaceB.finalState, 'claimed');
ok('FSM 图即控制面板：合法迁移 affected=1 / guard 拒 0(409) / 非法迁移 / 信用增减 / 并发双 claim 仅一成功');

const pubBad = biz['publish'].body;
assert.equal(pubBad.ok, false);
assert.ok(pubBad.audit.hits.length > 0);
const pipeBad = biz['pipeline'].body;
assert.equal(pipeBad.agents.length, 5);
assert.equal(pipeBad.agents[2].verdict.passed, false);
assert.ok(pipeBad.agents[2].verdict.hits.length > 0);
assert.equal(pipeBad.publishable, false);
ok('publish/pipeline：拦截带证据，五阶段齐活，违规不可发布');

const inj = await pair('POST', '/api/preview', { action: 'search', query: "'; DROP TABLE posts;--" });
assert.equal(inj.status, 200);
assert.ok(Array.isArray(inj.body.results));
const after = await pair('POST', '/api/preview', { action: 'search', query: '代拿外卖' });
assert.ok(after.body.results.length > 0);
ok('注入字符串只当普通文本，检索功能不受影响');

console.log(`\n线上验证全部通过（mode=${mode}）：${checks} 组断言（全路由状态码 + 业务语义 + 本地逐值对拍）`);