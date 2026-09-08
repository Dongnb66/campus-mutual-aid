// 多智能体定义：Router / Post / Search / Audit / Match
// 说明：若未配置模型 Key，各 Agent 自动回退到「规则兜底」，保证无 Key 也能演示核心流程。
import { chat } from './llm.js';
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
export async function searchPosts(query) {
  let cond = '';
  let params = [];
  try {
    const sys = `你是检索智能体。从用户查询提取用于数据库检索的关键词（分类/文本），只返回JSON：
{"category":string|null,"keywords":[string]}`;
    const parsed = await chat([
      { role: 'system', content: sys },
      { role: 'user', content: query },
    ], { response_format: { type: 'json_object' }, temperature: 0.2 });
    const p = JSON.parse(parsed);
    const cat = normStr(p.category);
    if (cat && CATEGORIES.includes(cat)) { cond += ' AND category=?'; params.push(cat); }
    const kws = Array.isArray(p.keywords)
      ? p.keywords.map(k => normStr(k)).filter(k => k && k.length <= 20).slice(0, 6)
      : [];
    kws.forEach(k => { cond += ' AND (title LIKE ? OR content LIKE ?)'; params.push(`%${k}%`, `%${k}%`); });
  } catch {
    // 规则兜底：按常见互助关键词匹配（中文无空格，不能用 split）
    const KEYWORDS = ['代拿', '外卖', '快递', '接课', '带课', '寻物', '丢失', '二手', '转卖', '组队', '拼', '带饭', '拿', '自行车', '奶茶', '签到'];
    const ks = KEYWORDS.filter(k => query.includes(k));
    if (ks.length === 0) { cond += ' AND (title LIKE ? OR content LIKE ?)'; params.push(`%${query}%`, `%${query}%`); }
    ks.forEach(k => { cond += ' AND (title LIKE ? OR content LIKE ?)'; params.push(`%${k}%`, `%${k}%`); });
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
// 规则兜底版：结合用户历史发帖分类偏好 + 报酬 + 新鲜度打分排序
export async function matchPosts(user, limit = 8) {
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
  myCats.forEach(r => pref[r.category] = r.c);

  const scored = rows.map(r => {
    let score = 0;
    score += pref[r.category] ? pref[r.category] * 3 : 0;       // 偏好加权
    if (r.reward && r.reward !== '—') score += 2;              // 有报酬优先
    if (r.author_credit >= 100) score += 2;                    // 信用高优先
    // 新鲜度：越近越高
    const ageH = (Date.now() - new Date(r.created_at).getTime()) / 3600000;
    score += Math.max(0, 5 - ageH / 12);
    return { ...r, score: Math.round(score * 10) / 10 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// 创建帖子（含审核）
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
    return { ok: false, reason: audit.reason };
  }
  const pid = db.prepare(
    'INSERT INTO posts(user_id,title,content,category,reward,contact,location,expected_time) VALUES (?,?,?,?,?,?,?,?)'
  ).run(user_id || 1, title, content, category, normStr(reward), normStr(contact), normStr(location), normStr(expected_time)).lastInsertRowid;
  db.prepare('INSERT INTO audit_log(post_id,passed,reason) VALUES (?,?,?)').run(pid, 1, audit.reason || '通过');
  db.prepare('INSERT INTO post_tags(post_id,tag) VALUES (?,?)').run(pid, category);
  return { ok: true, post_id: pid };
}
