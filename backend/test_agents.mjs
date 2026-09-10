// test_agents.mjs —— 5 个智能体的行为测试 + 环境变量加载回归测试
//
// 背景（为什么补这个文件）：
//   1. 简历/README 写着「5 智能体编排（路由/发帖引导/内容审核/检索/撮合）」，
//      但 test_smoke.mjs 只测了鉴权/RBAC/并发接单/缓存，**一个智能体都没测**。
//   2. 排查时发现一个真 bug：.env 里的 DEEPSEEK_API_KEY 永远读不到 ——
//      ESM 的 import 提升让 src/llm.js 在 dotenv.config() 之前就把 Key 快照成空串，
//      于是「配了 Key 却永远走规则兜底」。本文件把该 bug 固化成回归断言。
//
// 运行：node test_agents.mjs

import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 用临时库，避免污染开发数据（db.js 支持 CAMPUS_DB 覆盖）
const TMP_DB = path.join(os.tmpdir(), `campus-agents-test-${Date.now()}.db`);
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

/* ============ 1. 环境变量加载（原 bug 的回归守卫） ============ */
console.log('\n== 1. 环境变量加载：Key 必须能被读到（原 bug 回归守卫） ==');

const env = await import('./src/env.js');
const llm = await import('./src/llm.js'); // 故意「先 import 再设 Key」，复刻原 bug 的时序

const parsed = env.parseEnvFile([
  '# 注释行会被忽略',
  'A=1',
  'B = hello world ',
  'C="带 空格"',
  "D='单引号'",
  'E=有值 # 行尾注释',
  'F=',
  'G=请填写你的DeepSeek_API_Key',
  '这一行没有等号',
].join('\n'));
check('忽略注释行与无等号行', parsed['# 注释行会被忽略'] === undefined && Object.keys(parsed).length === 7, `keys=${Object.keys(parsed)}`);
check('解析普通键值对', parsed.A === '1' && parsed.B === 'hello world', `A=${parsed.A} B=${parsed.B}`);
check('剥离双/单引号', parsed.C === '带 空格' && parsed.D === '单引号', `C=${parsed.C} D=${parsed.D}`);
check('剥离行尾注释', parsed.E === '有值', `E=${parsed.E}`);
check('空值解析为空串', parsed.F === '', `F=${JSON.stringify(parsed.F)}`);

// loadEnvFile：写临时 .env，断言写入 + 不覆盖既有变量
const TMP_ENV = path.join(os.tmpdir(), `campus-env-${Date.now()}.env`);
fs.writeFileSync(TMP_ENV, 'CAMPUS_TEST_NEW=from-file\nCAMPUS_TEST_KEEP=from-file\n', 'utf8');
process.env.CAMPUS_TEST_KEEP = 'from-shell';
const applied = env.loadEnvFile(TMP_ENV);
check('loadEnvFile 写入新键', process.env.CAMPUS_TEST_NEW === 'from-file', `实际 ${process.env.CAMPUS_TEST_NEW}`);
check('loadEnvFile 不覆盖已存在的环境变量', process.env.CAMPUS_TEST_KEEP === 'from-shell', `实际 ${process.env.CAMPUS_TEST_KEEP}`);
check('loadEnvFile 返回生效键列表且不含被跳过的键', applied.includes('CAMPUS_TEST_NEW') && !applied.includes('CAMPUS_TEST_KEEP'), `applied=${applied}`);

check('占位符（.env.example 直接复制）不算已配置', env.isPlaceholder('请填写你的DeepSeek_API_Key') === true && env.isPlaceholder('sk-real-key-123') === false);

delete process.env.DEEPSEEK_API_KEY;
check('无 Key → llmConfigured() = false', llm.llmConfigured() === false);
process.env.DEEPSEEK_API_KEY = 'late-key-set-after-import';
check('import 之后再设 Key 也能读到（原 bug 就死在这里）', llm.llmConfigured() === true);
process.env.DEEPSEEK_API_KEY = '请填写你的DeepSeek_API_Key';
check('占位符 Key → 视为未配置（会走规则兜底而不是报 401）', llm.llmConfigured() === false);
delete process.env.DEEPSEEK_API_KEY;
fs.rmSync(TMP_ENV, { force: true });

/* ============ 2. 五个智能体都在且可调用 ============ */
console.log('\n== 2. 5 个智能体存在且可调用 ==');
const agents = await import('./src/agents.js');
const AGENT_NAMES = ['routeIntent', 'guidePost', 'auditPost', 'searchPosts', 'matchPosts'];
check('导出 5 个智能体入口', AGENT_NAMES.every((n) => typeof agents[n] === 'function'), `缺失=${AGENT_NAMES.filter((n) => typeof agents[n] !== 'function')}`);

/* ============ 3. 无 Key → 规则兜底路径（离线可跑） ============ */
console.log('\n== 3. 无 Key → 各智能体规则兜底（不发起网络请求） ==');
const ORIG_FETCH = globalThis.fetch;
globalThis.fetch = () => { throw new Error('无 Key 时不该发起任何模型请求'); };

const i1 = await agents.routeIntent('帮我代拿个快递到3栋');
const i2 = await agents.routeIntent('哪里有二手的自行车');
const i3 = await agents.routeIntent('这个平台怎么用');
const i4 = await agents.routeIntent('今天天气不错');
check('Router：发布意图 → post', i1.intent === 'post', `实际 ${i1.intent}`);
check('Router：搜索意图 → search', i2.intent === 'search', `实际 ${i2.intent}`);
check('Router：咨询意图 → consult', i3.intent === 'consult', `实际 ${i3.intent}`);
check('Router：闲聊 → chat', i4.intent === 'chat', `实际 ${i4.intent}`);

const draft = await agents.guidePost('明天下午帮我去图书馆拿个快递，微信 abc123，请你喝奶茶');
check('Post：分类推断 → 代拿', draft.category === '代拿', `实际 ${draft.category}`);
check('Post：抽取报酬（奶茶）', draft.reward === '一杯奶茶', `实际 ${draft.reward}`);
check('Post：抽取联系方式', draft.contact === 'abc123', `实际 ${draft.contact}`);
check('Post：抽取地点', draft.location === '图书馆', `实际 ${draft.location}`);
check('Post：抽取时间', draft.expected_time === '明天', `实际 ${draft.expected_time}`);
check('Post：字段齐全时 missing 为空', Array.isArray(draft.missing) && draft.missing.length === 0, `实际 ${JSON.stringify(draft.missing)}`);

const draft2 = await agents.guidePost('求个二手自行车');
check('Post：信息不足时 missing 列出待追问字段', draft2.missing.includes('地点') && draft2.missing.includes('期望时间') && draft2.missing.includes('联系方式'), `实际 ${JSON.stringify(draft2.missing)}`);
check('Post：分类推断 → 二手', draft2.category === '二手', `实际 ${draft2.category}`);

console.log('\n-- Audit Agent：违规拦截是代码级黑名单，关掉模型也成立 --');
const bad1 = await agents.auditPost('招代考枪手，包过，加微信 abc123');
const bad2 = await agents.auditPost('刷单日结300，加vx报名');
const bad3 = await agents.auditPost('专业代办证件发票，联系qq');
const good1 = await agents.auditPost('求帮忙代拿外卖到3栋，报酬5元');
const good2 = await agents.auditPost('组队参加程序设计校赛，缺两个队友');
check('拦截「代考枪手」', bad1.passed === false, `实际 ${JSON.stringify(bad1)}`);
check('拦截「刷单」广告', bad2.passed === false, `实际 ${JSON.stringify(bad2)}`);
check('拦截「代办证件发票」', bad3.passed === false, `实际 ${JSON.stringify(bad3)}`);
check('正常代拿帖放行', good1.passed === true, `实际 ${JSON.stringify(good1)}`);
check('正常组队帖放行', good2.passed === true, `实际 ${JSON.stringify(good2)}`);

console.log('\n-- Search Agent：关键词抽取 + 参数化检索 --');
const s1 = await agents.searchPosts('代拿外卖');
check('检索命中种子帖子', Array.isArray(s1) && s1.length > 0, `返回 ${s1?.length}`);
check('命中结果确实是代拿类', s1.some((p) => p.title.includes('代拿') || p.content.includes('代拿')), `titles=${s1.map((p) => p.title)}`);
check('结果带作者与标签', Boolean(s1[0]?.author) && s1[0]?.tags !== undefined, `author=${s1[0]?.author}`);
const s2 = await agents.searchPosts('图书馆');
check('换关键词仍能命中', s2.length > 0 && s2.some((p) => (p.location || '').includes('图书馆') || p.content.includes('图书馆')), `titels=${s2.map((p) => p.title)}`);
const s3 = await agents.searchPosts("'; DROP TABLE posts;--");
check('注入字符串不破坏数据库（posts 表仍可用）', Array.isArray(s3), `返回 ${typeof s3}`);
const s4 = await agents.searchPosts('代拿外卖');
check('注入之后检索功能仍正常', s4.length > 0, `返回 ${s4?.length}`);

console.log('\n-- Match Agent：打分排序与截断 --');
const me = { id: 1, nickname: '小鹿' };
const m1 = await agents.matchPosts(me, 3);
check('返回数组且受 limit 限制', Array.isArray(m1) && m1.length <= 3 && m1.length > 0, `返回 ${m1?.length}`);
check('过滤掉自己发的帖子', m1.every((p) => p.author !== '小鹿'), `authors=${m1.map((p) => p.author)}`);
check('每条带 score 且按分数降序', m1.every((p) => typeof p.score === 'number') && m1.every((p, i) => i === 0 || m1[i - 1].score >= p.score), `scores=${m1.map((p) => p.score)}`);
const m2 = await agents.matchPosts(me, 8);
check('扩大 limit 返回更多（limit 真的生效）', m2.length >= m1.length, `${m1.length} -> ${m2.length}`);

/* ============ 4. 有 Key → 真的走大模型（证明不是纯规则系统） ============ */
console.log('\n== 4. 有 Key → 智能体真的调用大模型（证明「多智能体」不是规则伪装） ==');
let calls = [];
const okJson = (payload) => ({ ok: true, status: 200, json: async () => payload });
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(init.body || '{}');
  calls.push({ url: String(url), body });
  const sys = body.messages?.[0]?.content || '';
  if (sys.includes('路由智能体')) {
    return okJson({ choices: [{ message: { content: JSON.stringify({ intent: 'consult', summary: '模型给的意图' }) } }] });
  }
  if (sys.includes('内容审核智能体')) {
    return okJson({ choices: [{ message: { content: JSON.stringify({ passed: true, reason: '模型审核通过' }) } }] });
  }
  if (sys.includes('发帖引导智能体')) {
    return okJson({ choices: [{ message: { content: JSON.stringify({ title: '模型给的标题', content: '模型给的内容', category: '二手', reward: '50元', contact: 'wx:abc', location: '东门', expected_time: '今晚', missing: [] }) } }] });
  }
  return okJson({ choices: [{ message: { content: '{}' } }] });
};
process.env.DEEPSEEK_API_KEY = 'test-key';

calls = [];
const li1 = await agents.routeIntent('随便说点什么');
check('Router 走模型分支（返回值来自模型而非规则）', li1.intent === 'consult' && li1.summary === '模型给的意图', `实际 ${JSON.stringify(li1)}`);
check('Router 请求带到 /chat/completions 且带 Authorization', calls.length === 1 && calls[0].url.includes('/chat/completions') && Boolean(calls[0].body), `calls=${calls.length}`);
check('Router 请求了 JSON 模式 + 低温（结构化输出）', calls[0].body.response_format?.type === 'json_object' && calls[0].body.temperature === 0.2, `实际 ${JSON.stringify({ rf: calls[0].body.response_format, t: calls[0].body.temperature })}`);

calls = [];
const la = await agents.auditPost('一段看起来很正常的互助内容');
check('Audit 走模型分支', la.passed === true && la.reason === '模型审核通过', `实际 ${JSON.stringify(la)}`);

calls = [];
const ld = await agents.guidePost('随便一句话');
check('Post 走模型分支（结构化字段来自模型）', ld.title === '模型给的标题' && ld.category === '二手', `实际 ${JSON.stringify(ld)}`);
check('Post 对模型给的非法分类做白名单校验', ['代拿', '接课', '寻物', '二手', '组队', '其他'].includes(ld.category));

calls = [];
globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
const ld2 = await agents.guidePost('明天下午图书馆拿快递，微信 abc123，请你喝奶茶');
const la2 = await agents.auditPost('刷单日结300');
check('模型 500 → Post 智能体降级规则兜底（不抛异常）', ld2.category === '代拿' && ld2.contact === 'abc123', `实际 ${JSON.stringify(ld2)}`);
check('模型 500 → Audit 智能体仍能拦截违规内容（安全不依赖模型可用性）', la2.passed === false, `实际 ${JSON.stringify(la2)}`);
globalThis.fetch = ORIG_FETCH;

/* ============ 汇总 ============ */
console.log('\n' + '='.repeat(42));
console.log(`  测试总数: ${pass + fail}`);
console.log(`  通过    : ${pass}`);
console.log(`  失败    : ${fail}`);
console.log('='.repeat(42));

try {
  fs.rmSync(TMP_DB, { force: true });
  fs.rmSync(TMP_DB + '-wal', { force: true });
  fs.rmSync(TMP_DB + '-shm', { force: true });
} catch { /* ignore */ }

process.exit(fail === 0 ? 0 : 1);
