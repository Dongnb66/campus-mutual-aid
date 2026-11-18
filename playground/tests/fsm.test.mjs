// fsm.test.mjs —— 「图即控制面板」状态机纯函数 + handler 路由测试。
// 运行：node --test playground/tests/fsm.test.mjs（或 node --test playground/tests/）
// 覆盖：合法/非法迁移、guard 拒绝（affectedRows=0）、并发双 claim 仅一成功、信用增减。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../functions/handler.mjs';
import {
  FSM_STATES, FSM_TRANSITIONS, FSM_CREDIT_NOTE, fsmTransition, fsmRace, CLAIM_SQL, completeSim,
} from '../functions/core.mjs';
import { SEED_POSTS } from '../functions/seed.mjs';

const BASE = 'https://campus-mutual-aid.example';
async function call(method, path, body) {
  const req = new Request(BASE + path, method === 'POST'
    ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method });
  const res = await handler({ request: req, env: {} });
  return { status: res.status, body: await res.json() };
}
const AUTHOR = 2;      // 种子发帖人（阿杰）
const ME = 90001;      // 演示接单人
const PEER = 90002;    // 并发对手

test('机器定义：5 状态 5 迁移；claim 边与 claimPostAtomic 的条件更新 SQL 逐字一致', () => {
  assert.deepEqual(FSM_STATES.map((s) => s.id), ['open', 'claimed', 'completed', 'cancelled', 'timeout']);
  assert.equal(FSM_TRANSITIONS.length, 5);
  assert.equal(FSM_STATES.filter((s) => s.terminal).length, 3);
  const claim = FSM_TRANSITIONS.find((t) => t.id === 'claim');
  assert.equal(claim.sql, CLAIM_SQL);
  assert.match(claim.sql, /WHERE id=\? AND status='open'/);
  assert.ok(FSM_CREDIT_NOTE.includes('+5'));
});

test('合法全路径：open→claimed→completed，每步 affectedRows=1 且带 SQL/guard', () => {
  const r1 = fsmTransition('open', 'claim', { authorId: AUTHOR, actorId: ME });
  assert.equal(r1.ok, true);
  assert.equal(r1.affectedRows, 1);
  assert.equal(r1.to, 'claimed');
  assert.equal(r1.acceptedBy, ME);
  const r2 = fsmTransition('claimed', 'complete', { authorId: AUTHOR, actorId: ME, acceptedBy: ME });
  assert.equal(r2.ok, true);
  assert.equal(r2.affectedRows, 1);
  assert.equal(r2.to, 'completed');
  assert.deepEqual(r2.credit, { helper: 5, author: 2 });
  for (const r of [r1, r2]) { assert.ok(r.sql); assert.ok(r.guard); }
});

test('claim guard：自己的帖 affectedRows=0（400），状态不迁移', () => {
  const r = fsmTransition('open', 'claim', { authorId: ME, actorId: ME });
  assert.equal(r.ok, false);
  assert.equal(r.code, 400);
  assert.equal(r.affectedRows, 0);
  assert.equal(r.to, null);
  assert.match(r.reason, /自己/);
});

test('条件更新语义：非 open 状态点 claim 一律 affectedRows=0（409），含三个终态', () => {
  for (const s of ['claimed', 'completed', 'cancelled', 'timeout']) {
    const r = fsmTransition(s, 'claim', { authorId: AUTHOR, actorId: PEER, acceptedBy: ME });
    assert.equal(r.ok, false, s);
    assert.equal(r.code, 409, s);
    assert.equal(r.affectedRows, 0, s);
    assert.equal(r.guardFailed, true, s);
    assert.equal(r.sql, CLAIM_SQL, s);
    assert.equal(r.to, null, s);
  }
});

test('非法迁移：无出边的 状态×事件 组合返回 illegal=true，affectedRows=0', () => {
  const cases = [
    ['open', 'complete'], ['open', 'timeout'],
    ['completed', 'cancel'], ['completed', 'complete'], ['completed', 'timeout'],
    ['cancelled', 'claim2'], ['cancelled', 'complete'],
    ['timeout', 'complete'], ['timeout', 'cancel'],
  ];
  for (const [s, e] of cases) {
    const r = fsmTransition(s, e, { authorId: AUTHOR, actorId: ME, acceptedBy: ME, overdue: true });
    assert.equal(r.ok, false, `${s}+${e}`);
    assert.equal(r.illegal, true, `${s}+${e}`);
    assert.equal(r.affectedRows, 0, `${s}+${e}`);
    assert.match(r.reason, /非法迁移/);
  }
});

test('complete guard：非接单人确认完成被拒（affectedRows=0）', () => {
  const r = fsmTransition('claimed', 'complete', { authorId: AUTHOR, actorId: PEER, acceptedBy: ME });
  assert.equal(r.ok, false);
  assert.equal(r.guardFailed, true);
  assert.equal(r.affectedRows, 0);
  assert.match(r.reason, /接单人/);
});

test('cancel 两条边：open 取消发帖人 −1；claimed 取消接单人 −2；陌生人取消被拒', () => {
  const a = fsmTransition('open', 'cancel', { authorId: AUTHOR, actorId: AUTHOR });
  assert.equal(a.ok, true);
  assert.equal(a.to, 'cancelled');
  assert.equal(a.transition, 'cancelOpen');
  assert.deepEqual(a.credit, { helper: 0, author: -1 });
  const b = fsmTransition('claimed', 'cancel', { authorId: AUTHOR, actorId: ME, acceptedBy: ME });
  assert.equal(b.ok, true);
  assert.equal(b.transition, 'cancelClaimed');
  assert.deepEqual(b.credit, { helper: -2, author: 0 });
  const c = fsmTransition('claimed', 'cancel', { authorId: AUTHOR, actorId: PEER, acceptedBy: ME });
  assert.equal(c.ok, false);
  assert.equal(c.affectedRows, 0);
  const d = fsmTransition('open', 'cancel', { authorId: AUTHOR, actorId: ME });
  assert.equal(d.ok, false);
  assert.equal(d.affectedRows, 0);
});

test('timeout guard：未超时限 affectedRows=0；超时限迁移且接单人 −3', () => {
  const early = fsmTransition('claimed', 'timeout', { authorId: AUTHOR, actorId: ME, acceptedBy: ME, overdue: false });
  assert.equal(early.ok, false);
  assert.equal(early.guardFailed, true);
  assert.equal(early.affectedRows, 0);
  assert.match(early.reason, /时限/);
  const late = fsmTransition('claimed', 'timeout', { authorId: AUTHOR, actorId: ME, acceptedBy: ME, overdue: true });
  assert.equal(late.ok, true);
  assert.equal(late.to, 'timeout');
  assert.equal(late.affectedRows, 1);
  assert.deepEqual(late.credit, { helper: -3, author: 0 });
});

test('并发双 claim：快照都见 open，仅第一个 affectedRows=1，第二个 0/409', () => {
  const r = fsmRace({ authorId: AUTHOR, firstUserId: ME, secondUserId: PEER });
  assert.equal(r.snapshot, 'open');
  assert.equal(r.results[0].ok, true);
  assert.equal(r.results[0].affectedRows, 1);
  assert.equal(r.results[1].ok, false);
  assert.equal(r.results[1].affectedRows, 0);
  assert.equal(r.results[1].code, 409);
  assert.equal(r.finalState, 'claimed');
  assert.equal(r.acceptedBy, ME);
  assert.equal(r.results[0].sql, r.results[1].sql);
});

test('并发边界：第一人=发帖人被 400 拒，第二人补位成功；两人都=发帖人则全拒', () => {
  const a = fsmRace({ authorId: ME, firstUserId: ME, secondUserId: PEER });
  assert.equal(a.results[0].code, 400);
  assert.equal(a.results[1].ok, true);
  assert.equal(a.acceptedBy, PEER);
  const b = fsmRace({ authorId: ME, firstUserId: ME, secondUserId: ME });
  assert.ok(b.results.every((x) => !x.ok));
  assert.equal(b.finalState, 'open');
  assert.equal(b.acceptedBy, null);
});

test('信用同源：complete 的 +5/+2 与 completeSim（server.js complete 路由口径）一致', () => {
  const accepted = SEED_POSTS.find((p) => p.status === 'accepted');
  const sim = completeSim(accepted);
  const fsm = fsmTransition('claimed', 'complete', { authorId: accepted.user_id, actorId: accepted.accepted_by, acceptedBy: accepted.accepted_by });
  assert.equal(fsm.credit.helper, sim.helper.delta);
  assert.equal(fsm.credit.author, sim.author.delta);
});

test('纯函数无副作用：重复调用结果一致，迁移表与 ctx 不被修改', () => {
  const tableBefore = JSON.stringify(FSM_TRANSITIONS);
  const ctx = Object.freeze({ authorId: AUTHOR, actorId: ME, acceptedBy: ME, overdue: true });
  const a = fsmTransition('claimed', 'timeout', ctx);
  const b = fsmTransition('claimed', 'timeout', ctx);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(FSM_TRANSITIONS), tableBefore);
  const race1 = fsmRace({ authorId: AUTHOR, firstUserId: ME, secondUserId: PEER });
  const race2 = fsmRace({ authorId: AUTHOR, firstUserId: ME, secondUserId: PEER });
  assert.deepEqual(race1, race2);
});

test('handler GET /api/fsm：状态/迁移/信用口径齐全，供 SVG 图渲染同源数据', async () => {
  const r = await call('GET', '/api/fsm');
  assert.equal(r.status, 200);
  assert.equal(r.body.states.length, 5);
  assert.equal(r.body.transitions.length, 5);
  assert.ok(r.body.creditNote.includes('−3'));
  assert.deepEqual(r.body.transitions, FSM_TRANSITIONS);
});

test('handler preview fsm：合法迁移 / guard 拒绝 / 非法迁移 / 未知状态 400', async () => {
  const ok = await call('POST', '/api/preview', { action: 'fsm', state: 'open', event: 'claim', authorId: AUTHOR, actorId: ME });
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.affectedRows, 1);
  assert.equal(ok.body.to, 'claimed');
  const guard = await call('POST', '/api/preview', { action: 'fsm', state: 'claimed', event: 'claim', authorId: AUTHOR, actorId: PEER, acceptedBy: ME });
  assert.equal(guard.body.ok, false);
  assert.equal(guard.body.code, 409);
  assert.equal(guard.body.affectedRows, 0);
  const illegal = await call('POST', '/api/preview', { action: 'fsm', state: 'open', event: 'complete', authorId: AUTHOR, actorId: ME });
  assert.equal(illegal.body.illegal, true);
  const badState = await call('POST', '/api/preview', { action: 'fsm', state: 'nope', event: 'claim' });
  assert.equal(badState.status, 400);
  const noEvent = await call('POST', '/api/preview', { action: 'fsm', state: 'open' });
  assert.equal(noEvent.status, 400);
});

test('handler preview fsmRace：与纯函数逐值一致；缺 userId 400', async () => {
  const r = await call('POST', '/api/preview', { action: 'fsmRace', authorId: AUTHOR, firstUserId: ME, secondUserId: PEER });
  assert.deepEqual(r.body.results, fsmRace({ authorId: AUTHOR, firstUserId: ME, secondUserId: PEER }).results);
  assert.equal(r.body.finalState, 'claimed');
  const viaUser = await call('POST', '/api/preview', { action: 'fsmRace', authorId: AUTHOR, user: { id: ME, nickname: '张三', credit: 100 } });
  assert.equal(viaUser.body.acceptedBy, ME);
  assert.equal(viaUser.body.results[1].code, 409);
  const bad = await call('POST', '/api/preview', { action: 'fsmRace' });
  assert.equal(bad.status, 400);
});