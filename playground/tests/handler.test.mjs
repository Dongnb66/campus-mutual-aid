// handler.test.mjs —— 公开演示版 edge handler 的本地测试（Node 24 自带 Request/Response）。
// 运行：node --test playground/tests/handler.test.mjs
// 打分断言用「规格公式」独立复算（偏好×3 / 报酬+2 / 信用≥100+2 / 新鲜度），不复用被测实现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../functions/handler.mjs';
import { SEED_POSTS, SEED_USERS } from '../functions/seed.mjs';
import { routeIntentRule, guidePostRule, auditPostRule } from '../functions/core.mjs';

const BASE = 'https://campus-mutual-aid.example';
const NOW = Date.parse('2026-11-17T00:00:00.000Z'); // 固定 now：种子帖新鲜度恒 0，逐值可复现

async function call(method, path, body) {
  const req = new Request(BASE + path, method === 'POST'
    ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method });
  const res = await handler({ request: req, env: {} });
  return { status: res.status, body: await res.json() };
}
const demoUser = { id: 90001, nickname: '张三', credit: 100 };

test('health：preview 模式 + 5 智能体 + 种子口径', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, 'preview');
  assert.equal(r.body.agents, 5);
  assert.deepEqual(r.body.seed, { users: 14, posts: 27 });
});

test('stats：与本地种子同口径（14 用户 / 27 帖 / 13 可接 / 3 进行中 / 11 完成）', async () => {
  const r = await call('GET', '/api/stats');
  assert.equal(r.body.users, 14);
  assert.equal(r.body.posts, 27);
  assert.equal(r.body.open, 13);
  assert.equal(r.body.accepted, 3);
  assert.equal(r.body.completed, 11);
  assert.equal(r.body.comments, 8);
  assert.equal(r.body.dms, 5);
});

test('种子信用分 = 初始100 + 完成单累加（接单+5 / 发帖+2），与 seed_demo 同规则', () => {
  const credit = {}, done = {};
  SEED_USERS.forEach((u) => { credit[u.id] = 100; done[u.id] = 0; });
  for (const p of SEED_POSTS) {
    if (p.status === 'completed' && p.accepted_by) {
      credit[p.accepted_by] += 5; done[p.accepted_by] += 1;
      credit[p.user_id] += 2;
    }
  }
  for (const u of SEED_USERS) {
    if (u.role === 'admin') continue;
    assert.equal(u.credit_score, credit[u.id], `user ${u.nickname} credit`);
    assert.equal(u.completed_count, done[u.id], `user ${u.nickname} completed`);
  }
  assert.equal(Object.values(done).reduce((a, b) => a + b, 0), 11);
});

test('互助榜：全量 27、分类过滤、关键词过滤', async () => {
  const all = await call('GET', '/api/posts');
  assert.equal(all.body.length, 27);
  const cat = await call('GET', '/api/posts?category=' + encodeURIComponent('代拿'));
  assert.ok(cat.body.length > 0);
  assert.ok(cat.body.every((p) => p.category === '代拿'));
  const q = await call('GET', '/api/posts?q=' + encodeURIComponent('快递'));
  assert.ok(q.body.length > 0);
  assert.ok(q.body.every((p) => (p.title + p.content).includes('快递')));
});

test('达人榜：按完成数、信用降序取 8', async () => {
  const r = await call('GET', '/api/top-helpers');
  assert.equal(r.body.list.length, 8);
  const expected = SEED_USERS.slice()
    .sort((a, b) => b.completed_count - a.completed_count || b.credit_score - a.credit_score)
    .slice(0, 8).map((u) => u.id);
  assert.deepEqual(r.body.list.map((u) => u.id), expected);
});

test('Router 规则兜底：四类意图（与本地 test_agents 同输入）', async () => {
  const cases = [
    ['帮我代拿个快递到3栋', 'post'],
    ['哪里有二手的自行车', 'search'],
    ['这个平台怎么用', 'consult'],
    ['今天天气不错', 'chat'],
  ];
  for (const [text, intent] of cases) {
    const r = await call('POST', '/api/preview', { action: 'route', text });
    assert.equal(r.body.intent, intent, text);
  }
});

test('Post 引导：字段抽取与本地断言逐值一致', async () => {
  const r = await call('POST', '/api/preview', { action: 'guide', text: '明天下午帮我去图书馆拿个快递，微信 abc123，请你喝奶茶' });
  const d = r.body.draft;
  assert.equal(d.category, '代拿');
  assert.equal(d.reward, '一杯奶茶');
  assert.equal(d.contact, 'abc123');
  assert.equal(d.location, '图书馆');
  assert.equal(d.expected_time, '明天');
  assert.deepEqual(d.missing, []);
  const r2 = await call('POST', '/api/preview', { action: 'guide', text: '求个二手自行车' });
  assert.equal(r2.body.draft.category, '二手');
  for (const f of ['地点', '期望时间', '联系方式']) assert.ok(r2.body.draft.missing.includes(f));
});

test('Audit 黑名单：三拦两放（与本地断言同输入）', async () => {
  for (const bad of ['招代考枪手，包过，加微信 abc123', '刷单日结300，加vx报名', '专业代办证件发票，联系qq']) {
    const r = await call('POST', '/api/preview', { action: 'audit', text: bad });
    assert.equal(r.body.passed, false, bad);
  }
  for (const good of ['求帮忙代拿外卖到3栋，报酬5元', '组队参加程序设计校赛，缺两个队友']) {
    const r = await call('POST', '/api/preview', { action: 'audit', text: good });
    assert.equal(r.body.passed, true, good);
  }
});

test('Search：关键词命中 + 注入字符串只当普通文本', async () => {
  const r = await call('POST', '/api/preview', { action: 'search', query: '代拿外卖' });
  assert.ok(r.body.results.length > 0);
  assert.ok(r.body.keywords.includes('代拿') && r.body.keywords.includes('外卖'));
  assert.ok(r.body.results.every((p) => p.status !== 'cancelled'));
  const inj = await call('POST', '/api/preview', { action: 'search', query: "'; DROP TABLE posts;--" });
  assert.equal(inj.status, 200);
  assert.ok(Array.isArray(inj.body.results));
  const after = await call('POST', '/api/preview', { action: 'search', query: '代拿外卖' });
  assert.ok(after.body.results.length > 0);
});

// 规格公式独立复算（ oracle ）：与 core 实现不共享代码
function oracleMatch(userId, posts, limit, now) {
  const pref = {};
  posts.filter((p) => p.user_id === userId).forEach((p) => { pref[p.category] = (pref[p.category] || 0) + 1; });
  const creditOf = (p) => {
    if (p.author_credit != null) return p.author_credit;
    const u = SEED_USERS.find((x) => x.id === p.user_id);
    return u ? u.credit_score : 0;
  };
  const cand = posts.filter((p) => p.status === 'open' && p.user_id !== userId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 50);
  const scored = cand.map((p) => {
    const ageH = (now - new Date(p.created_at).getTime()) / 3600000;
    const s = (pref[p.category] || 0) * 3
      + (p.reward && p.reward !== '—' ? 2 : 0)
      + (creditOf(p) >= 100 ? 2 : 0)
      + Math.max(0, 5 - ageH / 12);
    return { id: p.id, score: Math.round(s * 10) / 10 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

test('Match：固定 now 下与规格公式逐值一致（种子用户口径，top3 / limit8）', async () => {
  // 种子用户 id=1 与本地 matchPosts 同口径；handler 的演示身份段（>=90000）另测
  const { matchPostsRule } = await import('../functions/core.mjs');
  const r3 = matchPostsRule({ id: 1, nickname: '小鹿' }, SEED_POSTS, 3, NOW);
  assert.deepEqual(r3.map((p) => ({ id: p.id, score: p.score })), oracleMatch(1, SEED_POSTS, 3, NOW));
  assert.ok(r3.every((p) => p.user_id !== 1));
  const r8 = matchPostsRule({ id: 1, nickname: '小鹿' }, SEED_POSTS, 8, NOW);
  assert.deepEqual(r8.map((p) => ({ id: p.id, score: p.score })), oracleMatch(1, SEED_POSTS, 8, NOW));
  assert.ok(r8.length >= r3.length);
  // handler 路由同值（演示身份看全部种子帖，无自己的帖）
  const h = await call('POST', '/api/preview', { action: 'match', user: demoUser, limit: 8, now: NOW });
  assert.deepEqual(h.body.results.map((p) => ({ id: p.id, score: p.score })), oracleMatch(demoUser.id, SEED_POSTS, 8, NOW));
});

test('Match：演示帖并入重算——自己的帖不推荐给自己（与本地一致），但抬高同类偏好', async () => {
  const demo = { title: '帮忙代拿快递到9栋', content: '帮忙代拿快递到9栋，报酬5元', category: '代拿', reward: '5元', created_at_ms: NOW };
  const r = await call('POST', '/api/preview', { action: 'match', user: demoUser, demoPosts: [demo], limit: 8, now: NOW });
  assert.ok(!r.body.results.some((p) => p.demo), '自己的演示帖不应进入自己的撮合候选（本地 user_id!=? 语义）');
  // 演示用户发过 1 条代拿 → 其它代拿开放帖偏好分 = 3
  const otherDaina = r.body.results.filter((p) => !p.demo && p.category === '代拿');
  assert.ok(otherDaina.length > 0);
  assert.ok(otherDaina.every((p) => p.parts.pref === 3));
});

test('Match：同学视角看演示帖——新帖拿接近 5 的新鲜度分并参与排序', async () => {
  const demo = { title: '帮忙代拿快递到9栋', content: '帮忙代拿快递到9栋，报酬5元', category: '代拿', reward: '5元', created_at_ms: NOW, user_id: 90001, author: '张三', author_credit: 100 };
  const viewer = { id: 90002, nickname: '李四', credit: 100 };
  const r = await call('POST', '/api/preview', { action: 'match', user: viewer, demoPosts: [demo], limit: 8, now: NOW });
  const mine = r.body.results.find((p) => p.demo);
  assert.ok(mine, '同学的演示帖应进入撮合候选');
  assert.equal(mine.author, '张三');
  assert.ok(mine.parts.fresh > 4.9, '刚发的演示帖新鲜度应接近 5');
  const mergedPost = { ...demo, id: 90001, status: 'open', accepted_by: null, created_at: new Date(NOW).toISOString() };
  assert.deepEqual(r.body.results.map((p) => ({ id: p.id, score: p.score })), oracleMatch(viewer.id, [...SEED_POSTS, mergedPost], 8, NOW));
});

test('接单：race 模式第一成功第二 409；顺序模式第二 400', async () => {
  const race = await call('POST', '/api/preview', { action: 'claim', postId: 1, user: demoUser, mode: 'race', secondUserId: 90002 });
  assert.equal(race.body.results[0].ok, true);
  assert.equal(race.body.results[1].ok, false);
  assert.equal(race.body.results[1].code, 409);
  const seq = await call('POST', '/api/preview', { action: 'claim', postId: 1, user: demoUser });
  assert.equal(seq.body.results[0].ok, true);
  assert.equal(seq.body.results[1].code, 400);
});

test('接单边界：自己的帖 400 / 已完成帖 400 / 不存在 404', async () => {
  const own = await call('POST', '/api/preview', { action: 'claim', postId: 3, userId: 1 });
  assert.equal(own.body.results[0].code, 400);
  assert.match(own.body.results[0].error, /自己/);
  const completed = await call('POST', '/api/preview', { action: 'claim', postId: 6, userId: 90001 });
  assert.equal(completed.body.results[0].code, 400);
  const missing = await call('POST', '/api/preview', { action: 'claim', postId: 99999, userId: 90001 });
  assert.equal(missing.body.results[0].code, 404);
});

test('完成：接单 +5 / 发帖 +2 / 完成数 +1；非进行中 400', async () => {
  const accepted = SEED_POSTS.find((p) => p.status === 'accepted');
  const r = await call('POST', '/api/preview', { action: 'complete', postId: accepted.id });
  assert.equal(r.body.helper.delta, 5);
  assert.equal(r.body.author.delta, 2);
  assert.equal(r.body.helper.after, r.body.helper.before + 5);
  assert.equal(r.body.helper.completed_count, SEED_USERS.find((u) => u.id === accepted.accepted_by).completed_count + 1);
  const open = await call('POST', '/api/preview', { action: 'complete', postId: 1 });
  assert.equal(open.body.ok, false);
  assert.equal(open.body.code, 400);
});

test('publish：正常一句话过审出帖；违规内容拦截', async () => {
  const ok = await call('POST', '/api/preview', { action: 'publish', text: '明天下午帮我去图书馆拿个快递，微信 abc123，请你喝奶茶', user: demoUser, now: NOW });
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.post.category, '代拿');
  assert.equal(ok.body.post.created_at_ms, NOW);
  const bad = await call('POST', '/api/preview', { action: 'publish', text: '招代考枪手，包过，加微信 abc123', user: demoUser });
  assert.equal(bad.body.ok, false);
  assert.match(bad.body.reason, /违规/);
});

test('pipeline：五智能体齐活；违规不可发布；正常齐字段可发布', async () => {
  const bad = await call('POST', '/api/preview', { action: 'pipeline', text: '招代考枪手，包过，加微信 abc123', user: demoUser, now: NOW });
  assert.equal(bad.body.agents.length, 5);
  assert.equal(bad.body.agents[2].verdict.passed, false);
  assert.equal(bad.body.publishable, false);
  const good = await call('POST', '/api/preview', { action: 'pipeline', text: '明天下午帮我去图书馆拿个快递，微信 abc123，请你喝奶茶', user: demoUser, now: NOW });
  assert.equal(good.body.publishable, true);
  assert.equal(good.body.agents[0].verdict.intent, 'post');
});

test('输入守卫：未知 action 400 / 未知路由 404 / 演示 id 段校验 / 演示帖上限', async () => {
  const badAction = await call('POST', '/api/preview', { action: 'nope' });
  assert.equal(badAction.status, 400);
  const noRoute = await call('GET', '/api/nope');
  assert.equal(noRoute.status, 404);
  const badId = await call('POST', '/api/preview', { action: 'match', user: { id: 1, nickname: 'x' } });
  assert.equal(badId.status, 400);
  const many = await call('POST', '/api/preview', {
    action: 'match', user: demoUser,
    demoPosts: Array.from({ length: 21 }, (_, i) => ({ title: 't' + i, content: 'c', category: '其他', created_at_ms: NOW })),
  });
  assert.equal(many.status, 400);
});

test('演示帖清洗：非法分类归「其他」，状态强制 open', async () => {
  const r = await call('POST', '/api/preview', {
    action: 'search', query: '测试清洗', user: demoUser,
    demoPosts: [{ title: '测试清洗标题', content: '测试清洗内容', category: '黑客分类', created_at_ms: NOW }],
  });
  assert.equal(r.status, 200);
  const hit = r.body.results.find((p) => p.demo);
  assert.equal(hit.category, '其他');
  assert.equal(hit.status, 'open');
});

test('rules：信用 / 权重 / 智能体 / 本地能力清单齐全', async () => {
  const r = await call('GET', '/api/rules');
  assert.equal(r.body.credit.initial, 100);
  assert.equal(r.body.credit.completeHelper, 5);
  assert.equal(r.body.credit.completeAuthor, 2);
  assert.equal(r.body.matchWeights.length, 4);
  assert.equal(r.body.agents.length, 5);
  assert.ok(r.body.localOnly.length >= 4);
});

test('core 与 handler 同源：规则函数直接调用一致', () => {
  assert.equal(routeIntentRule('这个平台怎么用').intent, 'consult');
  assert.equal(guidePostRule('求个二手自行车').category, '二手');
  assert.equal(auditPostRule('刷单日结300').passed, false);
});

// ---- v1.1 升级：网关前缀 / 证据锚点 / 状态机口径 / 审核对照 ----

test('网关前缀兼容：/functions/v1/app/api/* 与 /api/* 同路由', async () => {
  const a = await call('GET', '/functions/v1/app/api/health');
  const b = await call('GET', '/api/health');
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, b.body);
  const p = await call('POST', '/functions/v1/app/api/preview', { action: 'route', text: '这个平台怎么用' });
  assert.equal(p.status, 200);
  assert.equal(p.body.intent, 'consult');
  const nf = await call('GET', '/functions/v1/app/api/nope');
  assert.equal(nf.status, 404);
});

test('审核证据锚点：hits 给出命中词与字符区间；正常内容 hits 为空', async () => {
  const text = '招代考枪手，包过，加微信 abc123';
  const r = await call('POST', '/api/preview', { action: 'audit', text });
  assert.equal(r.body.passed, false);
  assert.ok(Array.isArray(r.body.hits) && r.body.hits.length > 0);
  const h = r.body.hits[0];
  assert.equal(text.slice(h.start, h.end), h.word);
  assert.ok(/代考|枪手/.test(h.word));
  const good = await call('POST', '/api/preview', { action: 'audit', text: '求帮忙代拿外卖到3栋，报酬5元' });
  assert.equal(good.body.passed, true);
  assert.deepEqual(good.body.hits, []);
});

test('并发接单状态机口径：affectedRows=1 抢到 / 0 已被抢，附条件更新 SQL', async () => {
  const r = await call('POST', '/api/preview', { action: 'claim', postId: 1, user: demoUser, mode: 'race', secondUserId: 90002 });
  assert.equal(r.body.results[0].affectedRows, 1);
  assert.equal(r.body.results[1].affectedRows, 0);
  assert.match(r.body.results[0].sql, /UPDATE posts SET status='accepted'.*WHERE id=\? AND status='open'/);
  assert.equal(r.body.results[1].code, 409);
});

test('撮合证据锚点：每条结果带原帖摘录 marks + 四因子 notes，不改分数', async () => {
  const r = await call('POST', '/api/preview', { action: 'match', user: demoUser, limit: 8, now: NOW });
  for (const p of r.body.results) {
    assert.ok(p.evidence && typeof p.evidence.excerpt === 'string');
    assert.equal(p.evidence.notes.length, 4);
    for (const m of p.evidence.marks) {
      assert.ok(m.start >= 0 && m.end <= (m.in === 'title' ? p.title : p.evidence.excerpt).length);
      assert.ok(m.end > m.start);
    }
  }
  // 帖子 #1 报酬「5元」出现在正文里 → 应有报酬高亮区间
  const p1 = r.body.results.find((p) => p.id === 1);
  assert.ok(p1, 'post 1 应在候选中');
  const rewardMark = p1.evidence.marks.find((m) => m.label === '报酬 +2');
  assert.ok(rewardMark, '应有报酬证据高亮');
  assert.equal(p1.evidence.excerpt.slice(rewardMark.start, rewardMark.end), '5元');
});

test('审核开/关对照：开=27 帖进榜+2 拦截留痕；关=29 帖含违规样本', async () => {
  const on = await call('POST', '/api/preview', { action: 'board', audit: 'on' });
  assert.equal(on.status, 200);
  assert.equal(on.body.passedCount, 27);
  assert.equal(on.body.rows.length, 27);
  assert.ok(!on.body.rows.some((p) => p.compare));
  assert.equal(on.body.blocked.length, 2);
  assert.deepEqual(on.body.blocked.map((b) => b.id).sort(), [99001, 99002]);
  for (const b of on.body.blocked) {
    assert.ok(b.hits.length > 0);
    assert.equal(b.content.slice(b.hits[0].start, b.hits[0].end), b.hits[0].word);
  }
  const off = await call('POST', '/api/preview', { action: 'board', audit: 'off' });
  assert.equal(off.body.rows.length, 29);
  assert.equal(off.body.rows.filter((p) => p.compare).length, 2);
  assert.deepEqual(off.body.blocked, []);
  // 公开榜与撮合不受对照样本污染
  const board = await call('GET', '/api/posts');
  assert.ok(!board.body.some((p) => p.compare));
  const match = await call('POST', '/api/preview', { action: 'match', user: demoUser, limit: 20, now: NOW });
  assert.ok(!match.body.results.some((p) => p.compare));
});

test('publish 拦截与 pipeline 审核阶段都带命中词证据', async () => {
  const bad = await call('POST', '/api/preview', { action: 'publish', text: '招代考枪手，包过，加微信 abc123', user: demoUser });
  assert.equal(bad.body.ok, false);
  assert.ok(bad.body.audit.hits.length > 0);
  const pipe = await call('POST', '/api/preview', { action: 'pipeline', text: '招代考枪手，包过，加微信 abc123', user: demoUser, now: NOW });
  assert.equal(pipe.body.agents[2].verdict.passed, false);
  assert.ok(pipe.body.agents[2].verdict.hits.length > 0);
});