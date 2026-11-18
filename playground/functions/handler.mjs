// handler.mjs —— Qoder Sites edge 函数的 HTTP 层（无状态）。
// 签名 ({request, env})：Node 24 测试可直接 new Request 调；index.ts 用 Deno.serve 包一层。
// 公开榜 = 捆绑种子只读；一切交互（发帖引导/审核/检索/撮合/接单/完成）走 POST /api/preview
// 的无状态重算：演示身份与演示帖由浏览器 localStorage 携带，服务端不写任何公开数据。
import {
  CATEGORIES, SEED_POSTS, SEED_USERS, SEED_COMMENTS, SEED_DM_COUNT, COMPARE_POSTS, withAuthor, userById,
} from './seed.mjs';
import {
  routeIntentRule, guidePostRule, auditPostRule, auditHits, searchPostsRule, extractSearchKeywords,
  matchPostsRule, claimSim, completeSim, pipelineTrace,
} from './core.mjs';

const MAX_BODY = 100_000;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error('请求体超过 100KB 上限');
  if (!text) return {};
  const v = JSON.parse(text);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('请求体必须是 JSON 对象');
  return v;
}

const str = (v, name, max = 500) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} 必须是非空字符串`);
  if (v.length > max) throw new Error(`${name} 超长（上限 ${max} 字符）`);
  return v;
};

// 演示身份校验：id 必须落在演示段（>=90000），不与种子用户冲突
function demoUser(v) {
  if (!v || typeof v !== 'object') throw new Error('user 必须是对象');
  const id = Number(v.id);
  if (!Number.isInteger(id) || id < 90000) throw new Error('演示身份 id 必须 >= 90000');
  const nickname = str(v.nickname, 'nickname', 20).trim();
  const credit = Number.isFinite(Number(v.credit)) ? Math.max(0, Math.min(200, Number(v.credit))) : 100;
  return { id, nickname, credit_score: credit };
}

// 演示帖清洗：只接受演示段（>=90000）作者的 open 帖，字段白名单 + 长度上限。
// 保留原演示作者（支持「同学视角」看别人发的演示帖）；缺省归请求者。
function demoPosts(v, user) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Error('demoPosts 必须是数组');
  if (v.length > 20) throw new Error('演示帖最多 20 条');
  return v.map((p, i) => {
    if (!p || typeof p !== 'object') throw new Error('demoPosts 元素必须是对象');
    const category = CATEGORIES.includes(p.category) ? p.category : '其他';
    const createdAt = Number(p.created_at_ms);
    if (!Number.isFinite(createdAt)) throw new Error('演示帖缺少 created_at_ms');
    const uid = Number(p.user_id);
    const authorId = Number.isInteger(uid) && uid >= 90000 ? uid : user.id;
    const author = typeof p.author === 'string' && p.author.trim() ? p.author.trim().slice(0, 20) : user.nickname;
    const credit = Number(p.author_credit);
    const authorCredit = Number.isFinite(credit) ? Math.max(0, Math.min(200, credit)) : (authorId === user.id ? user.credit_score : 100);
    return {
      id: 90000 + i + 1,
      user_id: authorId,
      title: str(p.title, 'title', 60).trim(),
      content: str(p.content, 'content', 1000).trim(),
      category,
      reward: typeof p.reward === 'string' ? p.reward.slice(0, 40) : '',
      contact: typeof p.contact === 'string' ? p.contact.slice(0, 60) : '',
      location: typeof p.location === 'string' ? p.location.slice(0, 40) : '',
      expected_time: typeof p.expected_time === 'string' ? p.expected_time.slice(0, 40) : '',
      status: 'open',
      accepted_by: null,
      view_count: 0,
      created_at: new Date(createdAt).toISOString(),
      tags: [category],
      author,
      author_credit: authorCredit,
      demo: true,
    };
  });
}

function seedStats() {
  const byCategory = {};
  const byStatus = {};
  let views = 0;
  for (const p of SEED_POSTS) {
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    views += p.view_count;
  }
  return {
    ok: true,
    users: SEED_USERS.length,
    posts: SEED_POSTS.length,
    open: byStatus.open || 0,
    accepted: byStatus.accepted || 0,
    completed: byStatus.completed || 0,
    comments: SEED_COMMENTS.length,
    dms: SEED_DM_COUNT,
    views,
    byCategory: Object.entries(byCategory).map(([category, c]) => ({ category, c })).sort((a, b) => b.c - a.c),
    byStatus: Object.entries(byStatus).map(([status, c]) => ({ status, c })),
  };
}

function boardPosts(url) {
  const category = url.searchParams.get('category');
  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q');
  const like = (s, k) => String(s || '').toLowerCase().includes(String(k).toLowerCase());
  let rows = SEED_POSTS;
  if (category && category !== '全部') rows = rows.filter((p) => p.category === category);
  if (status) rows = rows.filter((p) => p.status === status);
  if (q) rows = rows.filter((p) => like(p.title, q) || like(p.content, q));
  return rows
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 50)
    .map(withAuthor);
}

function topHelpers() {
  return SEED_USERS
    .slice()
    .sort((a, b) => b.completed_count - a.completed_count || b.credit_score - a.credit_score)
    .slice(0, 8)
    .map(({ id, nickname, credit_score, completed_count }) => ({ id, nickname, credit_score, completed_count }));
}

const RULES = {
  credit: {
    initial: 100,
    completeHelper: 5,
    completeAuthor: 2,
    note: '每笔互助确认完成：接单人信用 +5、完成数 +1；发帖人信用 +2。信用只增不减的演示口径与本地完整版一致。',
  },
  matchWeights: [
    { factor: '分类偏好', weight: '历史同类发帖数 × 3', why: '你常发哪类求助，就更可能帮得上哪类忙' },
    { factor: '报酬', weight: '+2（报酬非空且非「—」）', why: '有明确答谢的求助优先撮合' },
    { factor: '信用', weight: '+2（作者信用 ≥ 100）', why: '信用良好的发帖人更可靠' },
    { factor: '新鲜度', weight: 'max(0, 5 − 帖龄小时 / 12)', why: '越新的求助越紧急，60 小时后归零' },
  ],
  audit: '代码级黑名单：刷单/赌博/网贷/色情/代考/枪手/替考/代课/代签到/办证/发票/诈骗广告/外挂/破解/传销/博彩等。审核不依赖模型可用性，拦截留痕可追溯。',
  agents: [
    { name: 'Router 路由', duty: '识别输入意图：发帖 / 检索 / 咨询 / 闲聊，分发给对应智能体' },
    { name: 'Post 发帖引导', duty: '一句话抽取标题/分类/报酬/联系方式/地点/时间，缺字段追问' },
    { name: 'Search 检索', duty: '自然语言转关键词，参数化检索防注入' },
    { name: 'Audit 审核', duty: '违规黑名单拦截，正常内容放行，结果留痕' },
    { name: 'Match 撮合', duty: '按偏好/报酬/信用/新鲜度加权打分，个性化排序' },
  ],
  localOnly: [
    '注册 / 登录：JWT 双令牌（短效 access + 可吊销 refresh），RBAC 学生/管理员分权',
    '持久发帖 / 评论 / 私信 / 通知：写本地数据库，公网演示版不写公开库',
    '并发接单：事务内条件更新（UPDATE ... WHERE status=\'open\'），changes=0 即 409',
    '缓存：内存 / 真 Redis 双后端，故障自动降级，空结果短 TTL 防穿透',
    '模型增强：配置模型 Key 后 5 智能体走大模型，无 Key 自动规则兜底（公网版即兜底路径）',
  ],
};

async function preview(body) {
  const action = str(body.action, 'action', 20);
  const now = body.now == null ? Date.now() : Number(body.now);
  if (!Number.isFinite(now)) throw new Error('now 必须是毫秒时间戳');
  const user = body.user == null ? null : demoUser(body.user);
  const demos = user ? demoPosts(body.demoPosts, user) : [];
  const merged = [...SEED_POSTS, ...demos];

  switch (action) {
    case 'route':
      return { ok: true, action, ...routeIntentRule(str(body.text, 'text', 500)) };
    case 'guide':
      return { ok: true, action, draft: guidePostRule(str(body.text, 'text', 500)) };
    case 'audit': {
      const text = str(body.text, 'text', 2000);
      return { ok: true, action, ...auditPostRule(text), hits: auditHits(text) };
    }
    case 'board': {
      // 审核开/关对照：种子 + 演示帖 + 内置违规对照样本。
      // audit=on（默认）按黑名单过滤并留痕；off 则全部放行——只用于演示差异，不写公开库。
      const auditOn = body.audit !== 'off';
      const pool = [...SEED_POSTS, ...demos, ...COMPARE_POSTS];
      const rows = [];
      const blocked = [];
      for (const p of pool) {
        const a = auditPostRule(p.content);
        if (a.passed) rows.push(withAuthor(p));
        else blocked.push({ id: p.id, title: p.title, content: p.content, reason: a.reason, hits: auditHits(p.content), compare: !!p.compare });
      }
      rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return { ok: true, action, audit: auditOn ? 'on' : 'off', total: pool.length, rows: auditOn ? rows : pool.map(withAuthor).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)), blocked: auditOn ? blocked : [], passedCount: rows.length };
    }
    case 'search': {
      const query = str(body.query ?? body.text, 'query', 200);
      return { ok: true, action, keywords: extractSearchKeywords(query), results: searchPostsRule(query, merged) };
    }
    case 'match': {
      if (!user) throw new Error('match 需要演示身份 user');
      const limit = body.limit == null ? 8 : Math.max(1, Math.min(20, Number(body.limit) || 8));
      return { ok: true, action, now, results: matchPostsRule(user, merged, limit, now) };
    }
    case 'publish': {
      if (!user) throw new Error('publish 需要演示身份 user');
      const text = str(body.text, 'text', 500);
      const draft = guidePostRule(text);
      const audit = auditPostRule(draft.content);
      if (!audit.passed) return { ok: false, action, audit: { ...audit, hits: auditHits(draft.content) }, reason: audit.reason };
      if (!draft.title || !draft.content) return { ok: false, action, audit, reason: '标题或内容为空' };
      return {
        ok: true, action, audit,
        post: {
          title: draft.title, content: draft.content, category: draft.category,
          reward: draft.reward, contact: draft.contact, location: draft.location,
          expected_time: draft.expected_time, created_at_ms: now, missing: draft.missing,
        },
      };
    }
    case 'claim': {
      const postId = Number(body.postId);
      const post = merged.find((p) => p.id === postId);
      const uid = user ? user.id : Number(body.userId);
      if (!Number.isInteger(uid)) throw new Error('claim 需要 userId 或演示身份');
      const race = body.mode === 'race';
      const second = race ? (body.secondUserId != null ? Number(body.secondUserId) : uid + 1) : null;
      return { ok: true, action, mode: race ? 'race' : 'sequential', results: claimSim(post, uid, { race, secondUserId: second }) };
    }
    case 'complete': {
      const postId = Number(body.postId);
      const post = merged.find((p) => p.id === postId);
      return { ok: true, action, ...completeSim(post) };
    }
    case 'pipeline': {
      const text = str(body.text, 'text', 500);
      return { ok: true, action, ...pipelineTrace(text, { user, demoPosts: demos, now }) };
    }
    default:
      throw new Error(`未知 action：${action}`);
  }
}

export async function handler({ request }) {
  const url = new URL(request.url);
  // 网关可能保留 /functions/v1/<物理函数名> 前缀（逻辑名 app 会被替换），
  // 这里统一剥掉前缀，只按 /api/* 业务路径路由；本地直调 /api/* 同样兼容。
  let pathname = url.pathname;
  const gw = pathname.match(/^\/functions\/v1\/[^/]+(\/.*)?$/);
  if (gw) pathname = gw[1] || '/';
  const path = pathname.replace(/\/+$/, '') || '/';
  try {
    if (request.method === 'GET') {
      if (path === '/api/health') {
        return json(200, { ok: true, service: 'campus-mutual-aid-playground', mode: 'preview', agents: 5, seed: { users: SEED_USERS.length, posts: SEED_POSTS.length } });
      }
      if (path === '/api/stats') return json(200, seedStats());
      if (path === '/api/posts') return json(200, boardPosts(url));
      if (path === '/api/top-helpers') return json(200, { ok: true, list: topHelpers() });
      if (path === '/api/rules') return json(200, { ok: true, ...RULES });
      if (path === '/api/categories') return json(200, { ok: true, categories: CATEGORIES });
      if (path.startsWith('/api/users/')) {
        const u = userById(Number(path.split('/').pop()));
        return u ? json(200, { ok: true, user: u }) : json(404, { ok: false, error: '用户不存在' });
      }
      return json(404, { ok: false, error: '接口不存在' });
    }
    if (request.method === 'POST' && path === '/api/preview') {
      const body = await readBody(request);
      const out = await preview(body);
      return json(200, out);
    }
    return json(404, { ok: false, error: '接口不存在' });
  } catch (e) {
    return json(400, { ok: false, error: e.message });
  }
}