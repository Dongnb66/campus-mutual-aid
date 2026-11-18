// core.mjs —— 公开演示版算法核心：与本地完整版 backend/src/agents.js 的
// 「无模型 Key 规则兜底」分支同源同权重（逐行移植，仅把 SQL 检索换成等价内存过滤）。
// 本地完整版配了模型 Key 时走大模型、无 Key 时走这里同一套规则；公网版不携带任何 Key，
// 因此恒定走规则兜底 —— 这正是本地断言测试覆盖的那条路径。
// 接单 / 完成 / 信用分语义来自 backend/src/db.js claimPostAtomic 与 server.js complete 路由。

import { CATEGORIES, SEED_POSTS, SEED_USERS, withAuthor } from './seed.mjs';

export { CATEGORIES };

function normStr(s) {
  return String(s || '').trim();
}

// 按关键词推断分类（与 agents.js guessCategory 逐字一致）
export function guessCategory(text) {
  if (/代拿|拿|外卖|快递|取|带饭|送/.test(text)) return '代拿';
  if (/接课|带课|代课|上课|签到|占座/.test(text)) return '接课';
  if (/寻物|丢失|丢了|捡到|失物|招领/.test(text)) return '寻物';
  if (/二手|转卖|出售|卖|闲置|回收/.test(text)) return '二手';
  if (/组队|拼|一起|结伴|组局|报名/.test(text)) return '组队';
  return '其他';
}

// 规则版字段抽取（与 agents.js extractDraftFields 逐字一致）
export function extractDraftFields(text) {
  const t = String(text || '');
  const out = { reward: '', contact: '', location: '', expected_time: '' };

  const contact = t.match(/(?:微信|vx|wx|qq|电话|联系方式|手机号|手机)\s*[:：]?\s*([a-zA-Z0-9_@.\-]{3,})/i);
  if (contact) out.contact = contact[1];

  const money = t.match(/(\d+(?:\.\d+)?)\s*(?:块钱?|元)/);
  if (money) out.reward = money[1] + '元';
  else if (/奶茶/.test(t)) out.reward = '一杯奶茶';
  else if (/咖啡/.test(t)) out.reward = '一杯咖啡';

  const dorm = t.match(/(\d+\s*栋)/);
  if (dorm) out.location = dorm[1];
  else {
    const place = t.match(/(食堂|图书馆|教学楼|主教|宿舍|寝室|操场|校医院|快递站|驿站|教室|门口|东门|西门|南门|北门|自习室|实验楼|理科楼)/);
    if (place) out.location = place[1];
  }

  const time = t.match(/(今晚|今天|明天|后天|下周|周[一二三四五六日天]|上午|下午|晚上|中午|早上|凌晨|\d{1,2}\s*[点时]\s*\d{0,2})/);
  if (time) out.expected_time = time[1];

  return out;
}

export function missingFields(draft) {
  const miss = [];
  if (!draft.title) miss.push('标题');
  if (!draft.content) miss.push('内容');
  if (!draft.location) miss.push('地点');
  if (!draft.expected_time) miss.push('期望时间');
  if (!draft.contact) miss.push('联系方式');
  return miss;
}

// ---- Router Agent 规则兜底（agents.js routeIntent 的 catch 分支，逐字一致）----
export function routeIntentRule(text) {
  if (/怎么用|规则|收费|安全|怎么发|如何|帮助|教程|咋/.test(text)) return { intent: 'consult', summary: text };
  if (/找|有没有|谁|搜|哪里|哪有|怎么找|求|有.*吗/.test(text)) return { intent: 'search', summary: text };
  if (/代拿|接课|带课|寻物|二手|组队|发布|发帖|帮忙|帮我|转让|捡到/.test(text)) return { intent: 'post', summary: text };
  return { intent: 'chat', summary: text };
}

// ---- Post Agent 规则兜底（agents.js guidePost 的 catch 分支，逐字一致）----
export function guidePostRule(text) {
  const extra = extractDraftFields(text);
  const draft = {
    title: String(text).slice(0, 18),
    content: String(text),
    category: guessCategory(text),
    ...extra,
    missing: [],
  };
  draft.missing = missingFields(draft);
  return draft;
}

// ---- Audit Agent 规则兜底（agents.js auditPost 的 catch 分支，黑名单逐字一致）----
const BANNED = [
  /刷单|赌博|网贷|贷款|色情|裸聊|代考|枪手|替考|代课|代签到|代点名|办证|发票|兼职.*(?:加vx|加微信|加qq)|银行卡.*出租|外挂|破解|倒卖.*(?:账号|票)|传销|博彩/,
];
export function auditPostRule(content) {
  if (BANNED.some((r) => r.test(content))) {
    return { passed: false, reason: '内容可能涉及违规（代考/代课/广告诈骗等），已拦截' };
  }
  return { passed: true, reason: '规则兜底审核通过' };
}

// 审核证据锚点：返回黑名单在原文中的命中词与字符区间（供 UI 高亮原帖摘录）。
// 与 auditPostRule 用同一张黑名单，只增加「命中在哪里」的可追溯信息，不改变判定。
export function auditHits(content) {
  const t = String(content || '');
  const hits = [];
  for (const r of BANNED) {
    const g = new RegExp(r.source, 'g');
    let m;
    while ((m = g.exec(t)) !== null) {
      hits.push({ word: m[0], start: m.index, end: m.index + m[0].length });
      if (m.index === g.lastIndex) g.lastIndex += 1;
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

// ---- Search Agent 规则兜底关键词表（agents.js searchPosts 的 catch 分支，逐字一致）----
export const SEARCH_KEYWORDS = ['代拿', '外卖', '快递', '接课', '带课', '寻物', '丢失', '二手', '转卖', '组队', '拼', '带饭', '拿', '自行车', '奶茶', '签到'];

export function extractSearchKeywords(query) {
  const ks = SEARCH_KEYWORDS.filter((k) => query.includes(k));
  return ks.length === 0 ? [String(query)] : ks;
}

// SQL 语义等价：status!='cancelled'，每个关键词 AND (title LIKE %k% OR content LIKE %k%)，
// ORDER BY created_at DESC LIMIT 12。SQLite LIKE 对 ASCII 不区分大小写，这里对齐。
export function searchPostsRule(query, posts = SEED_POSTS) {
  const ks = extractSearchKeywords(String(query || ''));
  const like = (s, k) => String(s || '').toLowerCase().includes(String(k).toLowerCase());
  const rows = posts
    .filter((p) => p.status !== 'cancelled' && ks.every((k) => like(p.title, k) || like(p.content, k)))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, 12);
  return rows.map(withAuthor);
}

// ---- Match Agent（agents.js matchPosts 的打分逐项同权重）----
// 候选：status='open' 且非本人帖，created_at DESC 取 50；
// score = 历史同类发帖数*3 + 有报酬(非'—')2 + 作者信用>=100 2 + max(0, 5-帖龄小时/12)，
// 四舍五入到 0.1，降序取 limit。parts 仅用于 UI 展示判据，不影响 score。
// evidence（证据锚点）：原帖摘录 + 得分依据在原文中的字符区间 marks + 逐因子 notes，
// 只服务 UI 展开高亮，不参与打分（与本地 matchPosts 的分数口径完全一致）。
function matchEvidence(r, joined, parts, pref, ageH) {
  const text = String(r.content || '');
  const marks = [];
  const notes = [];
  // 报酬：在原文里找报酬字样（「一杯奶茶」等量词短语退回到核心词）
  if (parts.reward > 0) {
    const cands = [r.reward, String(r.reward).replace(/^(一杯|一份|一个)/, '')].filter(Boolean);
    let found = null;
    for (const c of cands) {
      const i = text.indexOf(c);
      if (i >= 0) { found = { start: i, end: i + c.length }; break; }
    }
    if (found) marks.push({ ...found, label: '报酬 +2' });
    notes.push({ label: '报酬 +2', detail: `报酬字段「${r.reward}」非空且非「—」` });
  } else {
    notes.push({ label: '报酬 +0', detail: '无明确答谢（报酬为空或「—」）' });
  }
  // 偏好：历史同类发帖数 × 3，尝试在标题/正文里标出分类词
  const prefCount = pref[r.category] || 0;
  if (prefCount > 0) {
    const ti = String(r.title || '').indexOf(r.category);
    const ci = text.indexOf(r.category);
    if (ti >= 0) marks.push({ start: ti, end: ti + r.category.length, label: `偏好 +${parts.pref}`, in: 'title' });
    else if (ci >= 0) marks.push({ start: ci, end: ci + r.category.length, label: `偏好 +${parts.pref}` });
    notes.push({ label: `偏好 +${parts.pref}`, detail: `你历史发过 ${prefCount} 条「${r.category}」帖 × 3` });
  } else {
    notes.push({ label: '偏好 +0', detail: `你没有「${r.category}」类历史发帖` });
  }
  // 信用 / 新鲜度：元数据判据，给出数值依据
  const ac = joined.author_credit != null ? joined.author_credit : 0;
  notes.push({ label: `信用 +${parts.credit}`, detail: `作者信用 ${ac}${ac >= 100 ? ' ≥ 100' : ' < 100'}` });
  notes.push({ label: `新鲜度 +${Math.round(parts.fresh * 10) / 10}`, detail: `帖龄 ${ageH.toFixed(1)} 小时，max(0, 5 − 小时/12)` });
  return { excerpt: text, title: r.title, marks, notes };
}

export function matchPostsRule(user, posts = SEED_POSTS, limit = 8, now = Date.now()) {
  const rows = posts
    .filter((p) => p.status === 'open' && p.user_id !== user.id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, 50);

  const pref = {};
  posts.filter((p) => p.user_id === user.id).forEach((p) => { pref[p.category] = (pref[p.category] || 0) + 1; });

  const scored = rows.map((r) => {
    const joined = withAuthor(r);
    const authorCredit = joined.author_credit != null ? joined.author_credit : 0;
    const parts = {
      pref: pref[r.category] ? pref[r.category] * 3 : 0,
      reward: r.reward && r.reward !== '—' ? 2 : 0,
      credit: authorCredit >= 100 ? 2 : 0,
      fresh: 0,
    };
    const ageH = (now - new Date(r.created_at).getTime()) / 3600000;
    parts.fresh = Math.max(0, 5 - ageH / 12);
    const score = parts.pref + parts.reward + parts.credit + parts.fresh;
    return { ...joined, score: Math.round(score * 10) / 10, parts, evidence: matchEvidence(r, joined, parts, pref, ageH) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ---- 原子接单语义（db.js claimPostAtomic：事务内 UPDATE ... WHERE status='open'）----
// 无状态演示：race=true 模拟两个请求在事务快照里都看到 open，随后条件更新串行落盘——
// 第一个 changes=1 成功，第二个 changes=0 → 409；race=false 为顺序请求（第二次 400）。
// affectedRows 即 db.js 里 res.changes 的可视化口径：1=抢到，0=已被抢。
export const CLAIM_SQL = "UPDATE posts SET status='accepted', accepted_by=? WHERE id=? AND status='open'";
export function claimSim(post, userId, { race = false, secondUserId = null } = {}) {
  if (!post) return [{ ok: false, code: 404, error: '帖子不存在' }];
  const attempts = race && secondUserId != null ? [userId, secondUserId] : [userId, userId];
  let status = post.status;
  let acceptedBy = post.accepted_by;
  const pre = attempts.map(() => ({ status, user_id: post.user_id })); // 事务开始时的快照
  const results = [];
  attempts.forEach((uid, i) => {
    const snap = race ? pre[i] : { status, user_id: post.user_id };
    if (snap.user_id === uid) { results.push({ ok: false, code: 400, error: '不能接自己的帖' }); return; }
    if (snap.status !== 'open') { results.push({ ok: false, code: 400, error: '该帖已被接或已完成' }); return; }
    // 条件更新：只有当前真实状态仍是 open 才写入（changes===0 即被抢走）
    if (status === 'open') {
      status = 'accepted'; acceptedBy = uid;
      results.push({ ok: true, code: 200, accepted_by: uid, affectedRows: 1, sql: CLAIM_SQL });
    } else {
      results.push({ ok: false, code: 409, error: '手慢了，该帖刚被别人接走', affectedRows: 0, sql: CLAIM_SQL });
    }
  });
  return results;
}

// ---- 完成互助的信用分规则（server.js complete 路由：接单 +5 / 发帖 +2，接单完成数 +1）----
export function completeSim(post, users = SEED_USERS) {
  if (!post) return { ok: false, code: 404, error: '帖子不存在' };
  if (post.status !== 'accepted') return { ok: false, code: 400, error: '该帖未处于进行中' };
  const helper = users.find((u) => u.id === post.accepted_by);
  const author = users.find((u) => u.id === post.user_id);
  return {
    ok: true,
    helper: helper ? { id: helper.id, nickname: helper.nickname, before: helper.credit_score, after: helper.credit_score + 5, delta: 5, completed_count: helper.completed_count + 1 } : null,
    author: author ? { id: author.id, nickname: author.nickname, before: author.credit_score, after: author.credit_score + 2, delta: 2 } : null,
  };
}

// ---- 5 智能体流水线：一次输入，展示每个智能体各自的判据与结论 ----
export function pipelineTrace(text, { user = null, demoPosts = [], now = Date.now() } = {}) {
  const route = routeIntentRule(text);
  const draft = guidePostRule(text);
  const audit = auditPostRule(draft.content);
  const keywords = extractSearchKeywords(text);
  const merged = [...SEED_POSTS, ...demoPosts];
  const matches = user ? matchPostsRule(user, merged, 3, now) : [];
  return {
    agents: [
      { name: 'Router 路由', basis: '意图关键词：咨询/搜索/发布/闲聊 四类正则判据', verdict: route },
      { name: 'Post 发帖引导', basis: '分类词表 + 报酬/联系方式/地点/时间 字段抽取，缺字段列入 missing 追问', verdict: draft },
      { name: 'Audit 审核', basis: '代码级违规黑名单（代考/刷单/办证/诈骗广告等），不依赖模型可用性', verdict: { ...audit, hits: auditHits(draft.content) } },
      { name: 'Search 检索', basis: '16 个互助关键词命中抽取，参数化 LIKE 检索（防注入）', verdict: { keywords } },
      { name: 'Match 撮合', basis: '偏好×3 + 报酬+2 + 信用≥100+2 + 新鲜度 max(0,5-小时/12)', verdict: { top: matches.map((m) => ({ id: m.id, title: m.title, score: m.score })) } },
    ],
    publishable: route.intent === 'post' && audit.passed && draft.missing.length === 0,
  };
}