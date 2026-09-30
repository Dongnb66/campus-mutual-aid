// 智能体编排器：把 /api/chat 里 if-else 的调度收拢为一条显式、可审计的管线。
//
// 为什么要有这个文件（v2 升级的核心）：
//   v1 的「多智能体协作」实际是 server.js 里的一串 if-else——智能体之间没有
//   显式的传递关系，也没有任何执行痕迹可查。编排器把协作变成结构：
//     1. 每个智能体的调用都记录 trace（agent / action / 耗时 / 结果摘要）
//     2. 步数有硬上限（MAX_STEPS），编排失控时强制收敛
//     3. 智能体间传递显式化：Router 的输出决定走哪条支线，
//        createPost 内部 Audit 拒绝后回调 Guide 生成改写建议（见 agents.js），
//        Match 撮合时复用 Search 的查询理解作为工具（见 agents.js matchPosts）
//   对外契约不变：/api/chat 的响应字段与 v1 完全一致，trace 是新增字段。
import { routeIntent, guidePost, searchPosts, createPost } from './agents.js';

// 编排步数硬上限：到顶强制收敛，防止异常输入把管线拖进死循环
export const MAX_STEPS = 10;

const CONSULT_REPLY = '📌 使用指引：①注册登录后到「发帖」发布互助需求（代拿/接课/寻物/二手/组队）；②在「广场」浏览或「检索」用自然语言找帖；③看到合适的点「接单」，完成后双方信用加分；④陌生交易注意安全，平台已对内容进行AI审核。';
const CHAT_REPLY = '你好呀～我可以帮你：① 一句话发帖（如「帮忙代拿外卖到3栋，报酬5元」）；② 找帖（如「有没有人明天帮我带饭」）；③ 解答平台使用问题。试试看？';

function normStr(s) {
  return String(s || '').trim();
}

/**
 * 跑一条对话管线
 * @param {{message: string, user: {id: number}}} p
 * @returns {Promise<{intent: string, reply: string, trace: Array, draft?: object, result?: object, results?: Array}>}
 */
export async function runChatPipeline({ message, user }) {
  const trace = [];
  let steps = 0;

  // 包一层：每个智能体调用记一步 trace；步数到顶强制收敛
  const step = (agent, action, fn) => async (...args) => {
    if (steps >= MAX_STEPS) throw new Error(`编排步数达上限（${MAX_STEPS}），已中止`);
    steps += 1;
    const t0 = Date.now();
    try {
      const r = await fn(...args);
      trace.push({ agent, action, ms: Date.now() - t0, ok: true });
      return r;
    } catch (e) {
      trace.push({ agent, action, ms: Date.now() - t0, ok: false, detail: normStr(e.message).slice(0, 80) });
      throw e;
    }
  };

  // 第 1 步：Router 意图识别
  const route = await step('Router', '意图识别', routeIntent)(message);
  trace[trace.length - 1].detail = `${route.intent} · ${normStr(route.summary).slice(0, 40)}`;

  // 支线 A：发帖（Guide 抽取 → 字段齐则 Audit+发布；Audit 拒绝时其内部回调 Guide 出改写建议）
  if (route.intent === 'post') {
    const post = await step('Guide', '发帖草稿抽取', guidePost)(message);
    if (post && post.missing && post.missing.length) {
      return {
        intent: 'post',
        reply: `已生成发帖草稿，还需补充：${post.missing.join('、')}。\n（可在下方直接补全重发完整需求，或到「发帖」页按草稿补全后发布）`,
        draft: post,
        trace,
      };
    }
    if (!post || !post.title || !post.content) {
      return {
        intent: 'post',
        reply: '抱歉，我没能理解完整的发帖内容，请到「发帖」页补充标题和正文。',
        draft: post,
        trace,
      };
    }
    const r = await step('Audit', '内容审核+发布', createPost)({ ...post, user_id: user.id });
    const reply = r.ok
      ? `✅ 已为你发布互助帖：「${post.title}」`
      : `发布失败：${r.reason}${r.suggest ? `\n💡 ${r.suggest}` : ''}`;
    return { intent: 'post', reply, result: r, trace };
  }

  // 支线 B：检索
  if (route.intent === 'search') {
    const rows = await step('Search', '自然语言检索', searchPosts)(message);
    return {
      intent: 'search',
      reply: `为你找到 ${rows.length} 条相关帖子，已为你列出～`,
      results: rows,
      trace,
    };
  }

  // 支线 C：咨询（纯指引，固定话术）
  if (route.intent === 'consult') {
    return { intent: 'consult', reply: CONSULT_REPLY, trace };
  }

  // 支线 D：闲聊
  return { intent: 'chat', reply: CHAT_REPLY, trace };
}
