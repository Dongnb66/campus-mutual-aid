// 多智能体定义：Router / Post / Search / Audit / Match
// 说明：若未配置模型 Key，各 Agent 自动回退到「规则兜底」，保证无 Key 也能演示核心流程。
import { chat, llmConfigured } from './llm.js';
import db from './db.js';

export const CATEGORIES = ['代拿', '接课', '寻物', '二手', '组队', '其他'];

// 按关键词推断分类（兜底用）
function guessCategory(text) {
  if (/代拿|拿|外卖|快递|取|带饭|送/.test(text)) return '代拿';
  if (/接课|带课|代课|上课|签到|占座/.test(text)) return '接课';
  if (/寻物|丢失|丢了|捡到|失物|招领/.test(text)) return '寻物';
  if (/二手|转卖|出售|卖|闲置|回收/.test(text)) return '二手';
  if (/组队|拼|一起|结伴|组局|报名/.test(text)) return '组队';
  return '其他';
}

function normStr(s) {
  return String(s || '').trim();
}

// 规则版字段抽取：用于无 API Key 时把一句话发帖尽量结构化
function extractDraftFields(text) {
  const t = String(text || '');
  const out = { reward: '', contact: '', location: '', expected_time: '' };

  // 联系方式：vx/微信/qq/电话等
  const contact = t.match(/(?:微信|vx|wx|qq|电话|联系方式|手机号|手机)\s*[:：]?\s*([a-zA-Z0-9_@.\-]{3,})/i);
  if (contact) out.contact = contact[1];

  // 报酬：金额或奶茶/咖啡
  const money = t.match(/(\d+(?:\.\d+)?)\s*(?:块钱?|元)/);
  if (money) out.reward = money[1] + '元';
  else if (/奶茶/.test(t)) out.reward = '一杯奶茶';
  else if (/咖啡/.test(t)) out.reward = '一杯咖啡';

  // 地点：优先“数字+栋”，再匹配常见地点词
  const dorm = t.match(/(\d+\s*栋)/);
  if (dorm) out.location = dorm[1];
  else {
    const place = t.match(/(食堂|图书馆|教学楼|主教|宿舍|寝室|操场|校医院|快递站|驿站|教室|门口|东门|西门|南门|北门|自习室|实验楼|理科楼)/);
    if (place) out.location = place[1];
  }

  // 时间：常见中文时间表达
  const time = t.match(/(今晚|今天|明天|后天|下周|周[一二三四五六日天]|上午|下午|晚上|中午|早上|凌晨|\d{1,2}\s*[点时]\s*\d{0,2})/);
  if (time) out.expected_time = time[1];

  return out;
}

function missingFields(draft) {
  const miss = [];
  if (!draft.title) miss.push('标题');
  if (!draft.content) miss.push('内容');
  if (!draft.location) miss.push('地点');
  if (!draft.expected_time) miss.push('期望时间');
  if (!draft.contact) miss.push('联系方式');
  return miss;
}

// ---- Router Agent：意图识别 ----
export async function routeIntent(text) {
  try {
    const sys = `你是校园互助平台的路由智能体。判断用户输入意图，只返回JSON：
{"intent":"post"|"search"|"consult"|"chat","summary":"一句话理解"}
- post：想发布互助帖（代拿/接课/寻物/二手/组队等）
- search：想找/搜已有帖子（含「有没有/谁/求/怎么找」）
- consult：咨询平台如何使用、规则、安全、收费等问题
- chat：闲聊或其他`;
    const out = await chat([
      { role: 'system', content: sys },
      { role: 'user', content: text },
    ], { response_format: { type: 'json_object' }, temperature: 0.2 });
    const p = JSON.parse(out);
    if (['post', 'search', 'consult', 'chat'].includes(p.intent)) return p;
    return { intent: 'chat', summary: text };
  } catch {
    if (/怎么用|规则|收费|安全|怎么发|如何|帮助|教程|咋/.test(text)) return { intent: 'consult', summary: text };
    if (/找|有没有|谁|搜|哪里|哪有|怎么找|求|有.*吗/.test(text)) return { intent: 'search', summary: text };
    if (/代拿|接课|带课|寻物|二手|组队|发布|发帖|帮忙|帮我|转让|捡到/.test(text)) return { intent: 'post', summary: text };
    return { intent: 'chat', summary: text };
  }
}

// ---- Post Agent：发帖引导与分类 ----
export async function guidePost(text) {
  try {
    const sys = `你是发帖引导智能体。从用户输入中提取结构化帖子信息，只返回JSON：
{"title":string,"content":string,"category":${JSON.stringify(CATEGORIES)},"reward":string,"contact":string,"location":string,"expected_time":string,"missing":[缺失字段]}
若信息不足，missing 列出需追问的字段（如联系方式、地点、时间）。`;
    const out = await chat([
      { role: 'system', content: sys },
      { role: 'user', content: text },
    ], { response_format: { type: 'json_object' }, temperature: 0.3 });
    const d = JSON.parse(out);
    const extracted = extractDraftFields(text);
    const draft = {
      title: normStr(d.title) || String(text).slice(0, 18),
      content: normStr(d.content) || String(text),
      category: CATEGORIES.includes(d.category) ? d.category : guessCategory(text),
      reward: normStr(d.reward) || extracted.reward,
      contact: normStr(d.contact) || extracted.contact,
      location: normStr(d.location) || extracted.location,
      expected_time: normStr(d.expected_time) || extracted.expected_time,
      missing: []
    };
    draft.missing = Array.isArray(d.missing) && d.missing.length
      ? d.missing.map(normStr).filter(Boolean)
      : missingFields(draft);
    return draft;
  } catch {
    const extra = extractDraftFields(text);
    const draft = {
      title: String(text).slice(0, 18),
      content: String(text),
      category: guessCategory(text),
      ...extra,
      missing: []
    };
    draft.missing = missingFields(draft);
    return draft;
  }
}

// ---- Audit Agent：内容审核 ----
export async function auditPost(content) {
  try {
    const sys = `你是平台内容审核智能体。判断内容是否合规（无广告、无敏感词、非违规/诈骗信息、非违法内容），
只返回JSON：{"passed":true|false,"reason":string}`;
    const out = await chat([
      { role: 'system', content: sys },
      { role: 'user', content: content },
    ], { response_format: { type: 'json_object' }, temperature: 0.1 });
    const a = JSON.parse(out);
    const passed = a.passed === true;
    return { passed, reason: normStr(a.reason) || (passed ? '通过' : '内容不合规，已拦截') };
  } catch {
    const banned = [
      /刷单|赌博|网贷|贷款|色情|裸聊|代考|枪手|替考|代课|代签到|代点名|办证|发票|兼职.*(?:加vx|加微信|加qq)|银行卡.*出租|外挂|破解|倒卖.*(?:账号|票)|传销|博彩/
    ];
    if (banned.some((r) => r.test(content))) {
      return { passed: false, reason: '内容可能涉及违规（代考/代课/广告诈骗等），已拦截' };
    }
    return { passed: true, reason: '规则兜底审核通过' };
  }
}

// ---- Search Agent：自然语言搜帖 ----
//
// 查询理解单独拆成 extractQuery：它是 Search 智能体的「理解能力」，
// Match 智能体在带需求文本撮合时会把它当工具调用（真实的智能体间协作，
// 而不是各算各的）。规则兜底与 LLM 分支返回同一结构 {category, keywords}。
function ruleExtractQuery(query) {
  // 规则兜底：按常见互助关键词匹配（中文无空格，不能用 split）
  const KEYWORDS = ['代拿', '外卖', '快递', '接课', '带课', '寻物', '丢失', '二手', '转卖', '组队', '拼', '带饭', '拿', '自行车', '奶茶', '签到'];
  const ks = KEYWORDS.filter((k) => query.includes(k));
  return { category: null, keywords: ks.length ? ks : [query] };
}

export async function extractQuery(query) {
  if (!llmConfigured()) return ruleExtractQuery(query);
  try {
    const sys = `你是检索智能体。从用户查询提取用于数据库检索的关键词（分类/文本），只返回JSON：
{"category":string|null,"keywords":[string]}`;
    const parsed = await chat([
      { role: 'system', content: sys },
      { role: 'user', content: query },
    ], { response_format: { type: 'json_object' }, temperature: 0.2 });
    const p = JSON.parse(parsed);
    const cat = normStr(p.category);
    const kws = Array.isArray(p.keywords)
      ? p.keywords.map((k) => normStr(k)).filter((k) => k && k.length <= 20).slice(0, 6)
      : [];
    return { category: cat && CATEGORIES.includes(cat) ? cat : null, keywords: kws };
  } catch {
    return ruleExtractQuery(query);
  }
}

export async function searchPosts(query) {
  const q = await extractQuery(query);
  let cond = '';
  const params = [];
  if (q.category) { cond += ' AND category=?'; params.push(q.category); }
  for (const k of q.keywords) {
    cond += ' AND (title LIKE ? OR content LIKE ?)';
    params.push(`%${k}%`, `%${k}%`);
  }
  const rows = db.prepare(
    `SELECT p.id,p.title,p.content,p.category,p.reward,p.contact,p.location,p.expected_time,p.status,p.created_at,
            u.nickname AS author,u.avatar AS author_avatar,u.credit_score AS author_credit,
            GROUP_CONCAT(t.tag) AS tags
     FROM posts p LEFT JOIN users u ON p.user_id=u.id
     LEFT JOIN post_tags t ON p.id=t.post_id
     WHERE p.status!='cancelled' ${cond} GROUP BY p.id ORDER BY p.created_at DESC LIMIT 12`
  ).all(...params);
  return rows;
}

// ---- Match Agent：个性化推荐撮合 ----
//
// v2：从纯规则打分升级为真 LLM 智能体，三级流水：
//   1) SQL 粗筛候选池（50 条，排除自己/已取消）
//   2) [智能体间协作] 带需求文本时，调用 Search 智能体的 extractQuery 做查询理解
//   3) LLM 重排（给每条推荐理由 + 置信度）——置信 <0.6 / 排序非法 / 模型异常
//      一律回退规则打分（偏好 ×3 + 报酬 + 信用 + 新鲜度），无 Key 直接走规则版
// opts 兼容旧签名：matchPosts(user, 8) 与 matchPosts(user, { limit, query, trace }) 均可。
export async function matchPosts(user, opts = {}) {
  const o = typeof opts === 'number' ? { limit: opts } : (opts || {});
  const limit = o.limit || 8;
  const query = normStr(o.query || '');
  const trace = Array.isArray(o.trace) ? o.trace : null;

  // 1) 候选池粗筛
  const rows = db.prepare(
    `SELECT p.id,p.title,p.content,p.category,p.reward,p.location,p.expected_time,p.status,p.created_at,
            u.nickname AS author,u.avatar AS author_avatar,u.credit_score AS author_credit
     FROM posts p LEFT JOIN users u ON p.user_id=u.id
     WHERE p.status='open' AND p.user_id!=?
     ORDER BY p.created_at DESC LIMIT 50`
  ).all(user.id);

  // 用户历史发帖分类偏好
  const myCats = db.prepare('SELECT category, COUNT(*) c FROM posts WHERE user_id=? GROUP BY category').all(user.id);
  const pref = {};
  myCats.forEach((r) => { pref[r.category] = r.c; });

  const ruleScoreOf = (r) => {
    let score = 0;
    score += pref[r.category] ? pref[r.category] * 3 : 0;       // 偏好加权
    if (r.reward && r.reward !== '—') score += 2;              // 有报酬优先
    if (r.author_credit >= 100) score += 2;                    // 信用高优先
    // 新鲜度：越近越高
    const ageH = (Date.now() - new Date(r.created_at).getTime()) / 3600000;
    score += Math.max(0, 5 - ageH / 12);
    return Math.round(score * 10) / 10;
  };
  const ruleOrder = (pool) =>
    pool.map((r) => ({ ...r, score: ruleScoreOf(r), matched_by: 'rule' }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

  if (!rows.length) {
    trace?.push({ agent: 'Match', action: '候选池为空→规则兜底', detail: '候选 0 条' });
    return [];
  }

  // 2) [智能体间协作] 带需求文本 → 调 Search 智能体的查询理解作为工具
  let qinfo = null;
  if (query) {
    const t0 = Date.now();
    qinfo = await extractQuery(query);
    trace?.push({
      agent: 'Match→Search',
      action: '查询理解（工具复用）',
      ms: Date.now() - t0,
      detail: `category=${qinfo.category || '—'} keywords=${(qinfo.keywords || []).join('/') || '—'}`,
    });
  }

  // 3) 无 Key → 规则兜底（不发起任何模型请求）
  if (!llmConfigured()) {
    const result = ruleOrder(rows);
    trace?.push({ agent: 'Match', action: '规则兜底排序', detail: `候选 ${rows.length} 条（未配置 Key）` });
    return result;
  }

  // 4) LLM 重排（任何异常都回退规则版，撮合永远有结果）
  try {
    // 类目过滤：查询理解出明确类目时先收窄候选池（排空则放弃过滤）
    let pool = rows;
    if (qinfo?.category) {
      const narrowed = pool.filter((r) => r.category === qinfo.category);
      if (narrowed.length) pool = narrowed;
    }
    const t1 = Date.now();
    const sys = `你是撮合智能体。根据求助者画像与候选互助帖，输出个性化推荐排序。只返回JSON：
{"ranking":[{"id":number,"reason":"一句话推荐理由(不超过20字)"}],"confidence":0到1的小数}
要求：id 必须来自候选列表；ranking 最多 ${limit} 条；信息不足或不确定时降低 confidence。`;
    const userProfile = `求助者历史偏好分类：${Object.keys(pref).join('/') || '暂无'}${query ? `；当前需求：${query}` : ''}`;
    const candText = pool.slice(0, 20)
      .map((r) => `#${r.id} [${r.category}] ${r.title}｜报酬:${r.reward || '—'}｜地点:${r.location || '—'}｜时间:${r.expected_time || '—'}｜信用:${r.author_credit}`)
      .join('\n');
    const out = await chat([
      { role: 'system', content: sys },
      { role: 'user', content: `${userProfile}\n候选：\n${candText}` },
    ], { response_format: { type: 'json_object' }, temperature: 0.3 });
    const p = JSON.parse(out);
    const confidence = Number(p.confidence);
    const byId = new Map(pool.map((r) => [String(r.id), r]));
    const ranked = (Array.isArray(p.ranking) ? p.ranking : [])
      .map((x) => ({ x, row: byId.get(String(x?.id)) }))
      .filter((e) => e.row && normStr(e.x.reason))
      .slice(0, limit)
      .map((e, i) => ({
        ...e.row,
        score: ruleScoreOf(e.row) + (limit - i) / 10, // 模型序为主，规则分做次级锚
        match_reason: normStr(e.x.reason),
        matched_by: 'llm',
      }));
    if (confidence < 0.6 || ranked.length === 0) {
      throw new Error(`低置信(${Number.isFinite(confidence) ? confidence : 'NaN'})或空排序，回退规则版`);
    }
    // 模型只回了部分 → 其余候选按规则分续在后面，保证 limit 生效
    const rest = ruleOrder(rows).filter((r) => !ranked.some((x) => x.id === r.id));
    const result = [...ranked, ...rest].slice(0, limit);
    trace?.push({
      agent: 'Match',
      action: 'LLM 重排',
      ms: Date.now() - t1,
      detail: `候选 ${pool.length} 条 · 置信 ${confidence} · top1：${ranked[0]?.match_reason || '—'}`,
    });
    return result;
  } catch (e) {
    const result = ruleOrder(rows);
    trace?.push({ agent: 'Match', action: 'LLM 重排失败→规则兜底', detail: normStr(e.message).slice(0, 80) });
    return result;
  }
}

// ---- Guide 智能体第二职责：被拒后的改写建议 ----
// [智能体间协作] createPost 里 Audit 拒绝后调用本函数，把「拒绝原因 + 原文」
// 交给发帖引导智能体生成合规改写建议；无 Key/模型异常 → 规则建议（永远有产物）。
function ruleSuggest(reason) {
  return `请删除涉及违规的表述（${normStr(reason) || '内容不合规'}），保留正当求助意图后重新发布；建议补充具体的「物品/时间/地点/报酬」信息，更容易被接单。`;
}

export async function suggestRewrite(content, reason) {
  if (!llmConfigured()) return ruleSuggest(reason);
  try {
    const sys = `你是发帖引导智能体。用户的互助帖因「${normStr(reason) || '内容不合规'}」被审核拦截。
请给出一段合规的改写建议：去掉违规点、保留正当求助意图。只返回JSON：{"suggestion":string}`;
    const out = await chat([
      { role: 'system', content: sys },
      { role: 'user', content: String(content || '') },
    ], { response_format: { type: 'json_object' }, temperature: 0.4 });
    const s = normStr(JSON.parse(out).suggestion);
    return s || ruleSuggest(reason);
  } catch {
    return ruleSuggest(reason);
  }
}

// 创建帖子（含审核；Audit 拒绝 → Guide 生成改写建议一起返回）
export async function createPost({ user_id, title, content, category, reward, contact, location, expected_time }) {
  title = normStr(title);
  content = normStr(content);
  category = normStr(category);
  if (!title) return { ok: false, reason: '标题不能为空' };
  if (!content) return { ok: false, reason: '内容不能为空' };
  if (!CATEGORIES.includes(category)) return { ok: false, reason: '帖子分类无效' };

  const audit = await auditPost(content);
  if (!audit.passed) {
    // 被拦截内容也留痕，保证“审核可追溯”
    db.prepare('INSERT INTO audit_log(post_id,passed,reason) VALUES (?,?,?)').run(null, 0, audit.reason || '审核拦截');
    // [智能体间协作] Audit 拒绝 → Guide 给出合规改写建议，拒绝不再是死胡同
    const suggest = await suggestRewrite(content, audit.reason);
    return { ok: false, reason: audit.reason, suggest };
  }
  const pid = db.prepare(
    'INSERT INTO posts(user_id,title,content,category,reward,contact,location,expected_time) VALUES (?,?,?,?,?,?,?,?)'
  ).run(user_id || 1, title, content, category, normStr(reward), normStr(contact), normStr(location), normStr(expected_time)).lastInsertRowid;
  db.prepare('INSERT INTO audit_log(post_id,passed,reason) VALUES (?,?,?)').run(pid, 1, audit.reason || '通过');
  db.prepare('INSERT INTO post_tags(post_id,tag) VALUES (?,?)').run(pid, category);
  return { ok: true, post_id: pid };
}
