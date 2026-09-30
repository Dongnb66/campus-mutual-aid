// test_orchestrator.mjs —— 编排器 + 真·5 智能体协作的行为测试（v2 升级守卫）
//
// 测的是「协作是真的」这件事本身：
//   1. 编排器逐智能体 trace 可审计、步数上限存在
//   2. Match 撮合真的走 LLM 重排（matched_by='llm'），低置信/非法 id/模型 500 全部回退规则版
//   3. [智能体间协作] Match 带需求文本撮合时，先调 Search 的查询理解（fetch 调用顺序可证）
//   4. [智能体间协作] Audit 拒绝后回调 Guide 生成改写建议（有 Key 模型版 / 无 Key 规则版）
//
// 运行：node test_orchestrator.mjs

import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 临时库，避免污染开发数据（db.js 支持 CAMPUS_DB 覆盖）
const TMP_DB = path.join(os.tmpdir(), `campus-orch-test-${Date.now()}.db`);
process.env.CAMPUS_DB = TMP_DB;

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log('  [PASS]', name);
    pass++;
  } else {
    console.log('  [FAIL]', name, extra ? `-> ${extra}` : '');
    fail++;
  }
}

/* ============ 1. 无 Key：编排器与全部兜底路径（离线可跑，不发任何模型请求） ============ */
console.log('\n== 1. 无 Key：编排器结构 + 全链路规则兜底（fetch 一被调用就抛错） ==');

const ORIG_FETCH = globalThis.fetch;
globalThis.fetch = () => { throw new Error('无 Key 时不该发起任何模型请求'); };

const orch = await import('./src/orchestrator.js');
const agents = await import('./src/agents.js');
const db = (await import('./src/db.js')).default;

check('导出 runChatPipeline 与 MAX_STEPS', typeof orch.runChatPipeline === 'function' && orch.MAX_STEPS >= 1);

const user1 = { id: 1, nickname: '小鹿' };

// post 意图（规则兜底抽出的草稿缺联系方式/地点等 → 走 missing 分支）
const p1 = await orch.runChatPipeline({ message: '帮我代拿个快递', user: user1 });
check('编排器：post 意图走草稿分支', p1.intent === 'post' && Array.isArray(p1.draft?.missing), `实际 ${JSON.stringify({ intent: p1.intent, draft: p1.draft })}`);
check('编排器：trace 记录了 Router 与 Guide 两步', p1.trace.length >= 2 && p1.trace[0].agent === 'Router' && p1.trace.some((t) => t.agent === 'Guide'), `trace=${JSON.stringify(p1.trace.map((t) => t.agent))}`);
check('编排器：Router 的 trace 带意图摘要', p1.trace[0].detail.startsWith('post'), `实际 ${p1.trace[0].detail}`);

// search 意图
const p2 = await orch.runChatPipeline({ message: '哪里有二手的自行车', user: user1 });
check('编排器：search 意图返回结果数组 + trace 完整', p2.intent === 'search' && Array.isArray(p2.results) && p2.trace.length >= 2, `results=${p2.results?.length}`);

// consult 意图（只有 Router 一步）
const p3 = await orch.runChatPipeline({ message: '这个平台怎么用', user: user1 });
check('编排器：consult 意图一步直达', p3.intent === 'consult' && p3.trace.length === 1 && p3.trace[0].agent === 'Router', `trace=${JSON.stringify(p3.trace.map((t) => t.agent))}`);

// matchPosts：无 Key 规则路径（签名兼容：数字 limit 照旧可用）
const m1 = await agents.matchPosts(user1, { limit: 3 });
check('Match：无 Key 走规则版（matched_by 全为 rule）', Array.isArray(m1) && m1.length > 0 && m1.every((p) => p.matched_by === 'rule'), `实际 ${JSON.stringify(m1.map((p) => p.matched_by))}`);
check('Match：规则版 score 降序且为数字', m1.every((p, i) => typeof p.score === 'number' && (i === 0 || m1[i - 1].score >= p.score)), `scores=${m1.map((p) => p.score)}`);

// matchPosts 带 query（无 Key）：Match→Search 工具复用走规则版查询理解，仍不打模型
const trace2 = [];
const m2 = await agents.matchPosts(user1, { limit: 3, query: '帮我去图书馆拿外卖', trace: trace2 });
check('Match→Search：无 Key 时工具复用也记录在 trace', trace2.some((t) => t.agent === 'Match→Search' && t.action.includes('查询理解')), `trace=${JSON.stringify(trace2)}`);

/* ============ 2. 有 Key：LLM 重排与两条真实的智能体间协作 ============ */
console.log('\n== 2. 有 Key：LLM 重排 + 两条真实的智能体间协作 ==');

let calls = [];
let currentConfidence = 0.9;
let auditPassed = true;
let auditReason = '模型审核通过';
let routeMock = 'post';
const okJson = (payload) => ({ ok: true, status: 200, json: async () => payload });

process.env.DEEPSEEK_API_KEY = 'test-key';
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(init.body || '{}');
  const sys = body.messages?.[0]?.content || '';
  calls.push({ sys, user: body.messages?.[1]?.content || '' });
  if (sys.includes('撮合智能体')) {
    // 从候选文本解析真实 id，倒序输出（可证模型序确实被采纳）
    const ids = [...body.messages[1].content.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
    const ranking = ids.slice(0, 3).reverse().map((id) => ({ id, reason: `模型推荐#${id}` }));
    return okJson({ choices: [{ message: { content: JSON.stringify({ ranking, confidence: currentConfidence }) } }] });
  }
  if (sys.includes('检索智能体')) {
    return okJson({ choices: [{ message: { content: JSON.stringify({ category: null, keywords: ['外卖'] }) } }] });
  }
  if (sys.includes('发帖引导智能体') && sys.includes('审核拦截')) {
    return okJson({ choices: [{ message: { content: JSON.stringify({ suggestion: '模型给的改写建议' }) } }] });
  }
  if (sys.includes('发帖引导智能体')) {
    return okJson({ choices: [{ message: { content: JSON.stringify({ title: '模型标题', content: '模型内容', category: '代拿', reward: '5元', contact: 'wx:abc', location: '3栋', expected_time: '今晚', missing: [] }) } }] });
  }
  if (sys.includes('内容审核智能体')) {
    return okJson({ choices: [{ message: { content: JSON.stringify({ passed: auditPassed, reason: auditReason }) } }] });
  }
  if (sys.includes('路由智能体')) {
    return okJson({ choices: [{ message: { content: JSON.stringify({ intent: routeMock, summary: '模型给的意图' }) } }] });
  }
  return okJson({ choices: [{ message: { content: '{}' } }] });
};

// 7-9) Match LLM 重排：采纳模型序 / 低置信回退 / 非法 id 过滤
calls = [];
const m3 = await agents.matchPosts(user1, { limit: 3, trace: [] });
const llmItems = m3.filter((p) => p.matched_by === 'llm');
check('Match：有 Key 走 LLM 重排（matched_by=llm + 推荐理由）', llmItems.length > 0 && llmItems.every((p) => typeof p.match_reason === 'string' && p.match_reason), `实际 ${JSON.stringify(m3.map((p) => p.matched_by))}`);
check('Match：模型序被采纳（首个 llm 项的 reason 来自桩）', llmItems[0]?.match_reason === `模型推荐#${llmItems[0]?.id}`, `实际 ${llmItems[0]?.match_reason}`);
check('Match：发起且仅发起一次撮合请求（无多余调用）', calls.filter((c) => c.sys.includes('撮合智能体')).length === 1, `calls=${calls.length}`);

calls = [];
currentConfidence = 0.2;
const m4 = await agents.matchPosts(user1, { limit: 3 });
check('Match：低置信(<0.6)回退规则版（matched_by 全为 rule）', m4.every((p) => p.matched_by === 'rule'), `实际 ${JSON.stringify(m4.map((p) => p.matched_by))}`);

calls = [];
currentConfidence = 0.9;
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(init.body || '{}');
  const sys = body.messages?.[0]?.content || '';
  calls.push({ sys, user: body.messages?.[1]?.content || '' });
  if (sys.includes('撮合智能体')) {
    // 全部返回不存在的 id → 过滤后为空 → 应回退规则版
    return okJson({ choices: [{ message: { content: JSON.stringify({ ranking: [{ id: 99999, reason: '伪造id' }], confidence: 0.95 }) } }] });
  }
  return okJson({ choices: [{ message: { content: '{}' } }] });
};
const m5 = await agents.matchPosts(user1, { limit: 3 });
check('Match：模型给的非法 id 被过滤（不出现 99999，回退规则版）', m5.length > 0 && m5.every((p) => p.id !== 99999 && p.matched_by === 'rule'), `实际 ${JSON.stringify(m5.map((p) => p.id))}`);

// 10) [智能体间协作] 带需求文本撮合：先 Search 的查询理解，再 Match 的重排（fetch 顺序可证）
calls = [];
currentConfidence = 0.9;
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(init.body || '{}');
  const sys = body.messages?.[0]?.content || '';
  calls.push({ sys, user: body.messages?.[1]?.content || '' });
  if (sys.includes('撮合智能体')) {
    const ids = [...body.messages[1].content.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
    const ranking = ids.slice(0, 3).reverse().map((id) => ({ id, reason: `模型推荐#${id}` }));
    return okJson({ choices: [{ message: { content: JSON.stringify({ ranking, confidence: 0.9 }) } }] });
  }
  if (sys.includes('检索智能体')) {
    return okJson({ choices: [{ message: { content: JSON.stringify({ category: '代拿', keywords: ['外卖'] }) } }] });
  }
  return okJson({ choices: [{ message: { content: '{}' } }] });
};
const m6 = await agents.matchPosts(user1, { limit: 3, query: '帮我拿外卖' });
const iSearch = calls.findIndex((c) => c.sys.includes('检索智能体'));
const iMatch = calls.findIndex((c) => c.sys.includes('撮合智能体'));
check('协作1：Match→Search 查询理解先于撮合重排（fetch 顺序可证）', iSearch > -1 && iMatch > -1 && iSearch < iMatch, `search=${iSearch} match=${iMatch}`);

// 11) 模型 500 → 撮合降级规则版（不抛异常，安全不依赖模型可用性）
globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
const m7 = await agents.matchPosts(user1, { limit: 3 });
check('Match：模型 500 → 降级规则版（不抛异常）', m7.length > 0 && m7.every((p) => p.matched_by === 'rule'), `实际 ${JSON.stringify(m7.map((p) => p.matched_by))}`);

// 12) [智能体间协作] Audit 拒绝 → Guide 生成改写建议（模型版）+ audit_log 留痕
calls = [];
currentConfidence = 0.9;
auditPassed = false;
auditReason = '模型判违规';
routeMock = 'post';
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(init.body || '{}');
  const sys = body.messages?.[0]?.content || '';
  calls.push({ sys, user: body.messages?.[1]?.content || '' });
  if (sys.includes('发帖引导智能体') && sys.includes('审核拦截')) {
    return okJson({ choices: [{ message: { content: JSON.stringify({ suggestion: '模型给的改写建议' }) } }] });
  }
  if (sys.includes('内容审核智能体')) {
    return okJson({ choices: [{ message: { content: JSON.stringify({ passed: false, reason: auditReason }) } }] });
  }
  return okJson({ choices: [{ message: { content: '{}' } }] });
};
const before = db.prepare('SELECT COUNT(*) c FROM audit_log WHERE passed=0').get().c;
const r1 = await agents.createPost({ user_id: 1, title: '测试帖', content: '一段会被模型拒绝的内容', category: '其他' });
check('协作2：Audit 拒绝 → Guide 改写建议随结果返回', r1.ok === false && r1.suggest === '模型给的改写建议', `实际 ${JSON.stringify(r1)}`);
check('协作2：拒绝留痕（audit_log 新增失败记录）', db.prepare('SELECT COUNT(*) c FROM audit_log WHERE passed=0').get().c === before + 1);

// 13) 无 Key 时拒绝 → 规则版建议（建议永远有产物）
delete process.env.DEEPSEEK_API_KEY;
globalThis.fetch = () => { throw new Error('无 Key 时不该发起任何模型请求'); };
const r2 = await agents.createPost({ user_id: 1, title: '测试帖2', content: '招代考枪手，包过', category: '其他' });
check('协作2：无 Key 拒绝 → 规则版改写建议（非空且含指引）', r2.ok === false && typeof r2.suggest === 'string' && r2.suggest.includes('请删除'), `实际 ${JSON.stringify(r2.suggest)}`);

/* ============ 3. 有 Key：编排器完整发布链路（Router→Guide→Audit 三步 trace） ============ */
console.log('\n== 3. 有 Key：编排器完整发布链路 ==');

process.env.DEEPSEEK_API_KEY = 'test-key';
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(init.body || '{}');
  const sys = body.messages?.[0]?.content || '';
  if (sys.includes('路由智能体')) {
    return okJson({ choices: [{ message: { content: JSON.stringify({ intent: 'post', summary: '发帖' }) } }] });
  }
  if (sys.includes('发帖引导智能体')) {
    return okJson({ choices: [{ message: { content: JSON.stringify({ title: '模型标题', content: '模型内容', category: '代拿', reward: '5元', contact: 'wx:abc', location: '3栋', expected_time: '今晚', missing: [] }) } }] });
  }
  if (sys.includes('内容审核智能体')) {
    return okJson({ choices: [{ message: { content: JSON.stringify({ passed: true, reason: '模型审核通过' }) } }] });
  }
  return okJson({ choices: [{ message: { content: '{}' } }] });
};
const p4 = await orch.runChatPipeline({ message: '帮忙代拿外卖到3栋，报酬5元，微信abc123', user: user1 });
check('编排器：完整发布链路 Router→Guide→Audit 三步 trace', p4.intent === 'post' && ['Router', 'Guide', 'Audit'].every((a) => p4.trace.some((t) => t.agent === a)), `trace=${JSON.stringify(p4.trace.map((t) => t.agent))}`);
check('编排器：发布成功且 reply/result 契约不变', p4.reply.includes('已为你发布') && p4.result?.ok === true, `实际 ${JSON.stringify(p4.result)}`);

/* ============ 汇总 ============ */
console.log('\n' + '='.repeat(42));
console.log(`  测试总数: ${pass + fail}`);
console.log(`  通过    : ${pass}`);
console.log(`  失败    : ${fail}`);
console.log('='.repeat(42));

globalThis.fetch = ORIG_FETCH;
try {
  fs.rmSync(TMP_DB, { force: true });
  fs.rmSync(TMP_DB + '-wal', { force: true });
  fs.rmSync(TMP_DB + '-shm', { force: true });
} catch { /* ignore */ }

process.exit(fail === 0 ? 0 : 1);
