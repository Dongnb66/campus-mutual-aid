// 校园互助信息发布平台 - 后端入口（Express + 多智能体 + 鉴权）
// 必须是第一个 import：ESM 的 import 会被提升，.env 要在其它模块加载前就绪
import './src/env.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { getUser, getPostAuthor, addNotification, changeCredit, incCompleted, claimPostAtomic, deleteUserRefreshTokens, getOpsStats, getIdentities, createVerifyCode, checkVerifyCode } from './src/db.js';
import { register, login, authMiddleware, refreshAccessToken, logout, requireRole, phoneRegister, phoneLogin, oauthLogin, bindCurrentUser, bindContact } from './src/auth.js';
import { sendVerifyCode, detectChannel, channelStatus } from './src/verify.js';
import { cache, getOrSet, initCache, cacheBackend } from './src/cache.js';
import { routeIntent, guidePost, searchPosts, matchPosts, createPost, CATEGORIES } from './src/agents.js';
import { chat } from './src/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

// 运营维护：结构化请求日志（方法 / 路径 / 状态码 / 耗时）
const BOOT_TIME = Date.now();
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - t}ms)`);
  });
  next();
});

// 帖子 + 作者信息 + 标签
function postView(id) {
  return db.prepare(
    `SELECT p.*, u.nickname AS author, u.avatar AS author_avatar, u.credit_score AS author_credit, u.grade AS author_grade,
            GROUP_CONCAT(t.tag) AS tags
     FROM posts p LEFT JOIN users u ON p.user_id=u.id
     LEFT JOIN post_tags t ON p.id=t.post_id
     WHERE p.id=? GROUP BY p.id`
  ).get(id);
}

/* ============ 鉴权 ============ */
app.post('/api/auth/register', (req, res) => {
  try { res.json(register(req.body)); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/auth/login', (req, res) => {
  try { res.json(login(req.body)); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const u = getUser(req.user.id);
  res.json(u ? { ok: true, user: u } : { ok: false, error: '用户不存在' });
});

// 用 refresh token 换取新的 access token（双令牌刷新，避免频繁重新登录）
app.post('/api/auth/refresh', (req, res) => {
  try { res.json({ ok: true, ...refreshAccessToken(req.body.refreshToken) }); }
  catch (e) { res.status(401).json({ ok: false, error: e.message }); }
});

// 登出：吊销当前 refresh token
app.post('/api/auth/logout', (req, res) => {
  try { res.json(logout(req.body.refreshToken)); }
  catch { res.json({ ok: true }); }
});

/* ============ 手机号 / 第三方登录 / 绑定 ============ */
app.post('/api/auth/phone/register', (req, res) => {
  try { res.json(phoneRegister(req.body)); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/auth/phone/login', (req, res) => {
  try { res.json(phoneLogin(req.body)); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.get('/api/auth/:provider/callback', async (req, res) => {
  const provider = req.params.provider;
  if (provider !== 'wechat' && provider !== 'qq') return res.status(400).json({ ok: false, error: '不支持的第三方' });
  try { res.json(await oauthLogin(provider, req.query.code)); }
  catch (e) { res.status(401).json({ ok: false, error: e.message }); }
});
app.post('/api/auth/bind', authMiddleware, (req, res) => {
  try { res.json(bindCurrentUser(req.user.id, req.body.provider, req.body.externalId)); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.get('/api/auth/me/identities', authMiddleware, (req, res) => {
  res.json({ ok: true, identities: getIdentities(req.user.id) });
});

/* ============ 验证码（腾讯云短信 / 邮箱 SMTP）+ 第三方扫码登录 ============ */
// 发送验证码：手机号走腾讯云 SMS（配了密钥就真发），邮箱走 SMTP；未配置则演示模式回传验证码
app.post('/api/verify/send', async (req, res) => {
  const { target, scene } = req.body || {};
  const channel = detectChannel(target);
  if (!channel) return res.status(400).json({ ok: false, error: '请输入正确的手机号或邮箱' });
  const sceneName = scene === 'third_login' ? 'third_login' : 'bind';
  const { code } = createVerifyCode(target, channel, sceneName);
  const r = await sendVerifyCode(target, channel, code);
  res.json({ ok: true, channel, scene: sceneName, delivered: r.delivered, devCode: r.devCode, expireSec: 300, fallback: r.fallback || false, reason: r.reason || '' });
});
// 通道状态：显示当前是真实下发还是演示模式（运维可观测）
app.get('/api/verify/channels', (req, res) => {
  res.json({ ok: true, channels: channelStatus() });
});
app.post('/api/verify/check', (req, res) => {
  const { target, code, scene } = req.body || {};
  const r = checkVerifyCode(target, code, scene === 'third_login' ? 'third_login' : 'bind');
  res.status(r.ok ? 200 : 400).json(r);
});
// 第三方扫码登录：已绑定直接进；首次需 target(手机号/邮箱) + verifyCode 完成验证并绑定
app.post('/api/auth/third/login', async (req, res) => {
  const { provider, code, target, verifyCode } = req.body || {};
  try {
    const r = await oauthLogin(provider, code, target, verifyCode);
    res.status(r.ok || r.needBind ? 200 : 401).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});
// 已登录用户绑定手机号/邮箱（需验证码）
app.post('/api/auth/bind/contact', authMiddleware, (req, res) => {
  const { target, verifyCode } = req.body || {};
  const r = bindContact(req.user.id, target, verifyCode);
  res.status(r.ok ? 200 : 400).json(r);
});

/* ============ 运营维护 ============ */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptimeSec: Math.round((Date.now() - BOOT_TIME) / 1000), time: new Date().toISOString(), cache: cacheBackend });
});
app.get('/api/admin/ops', authMiddleware, requireRole('admin'), (req, res) => {
  res.json({ ok: true, stats: getOpsStats(), uptimeSec: Math.round((Date.now() - BOOT_TIME) / 1000) });
});

/* ============ 用户公开主页 ============ */
app.get('/api/users/find', (req, res) => {
  const n = (req.query.nickname || '').trim();
  if (!n) return res.json({ ok: false });
  const u = db.prepare('SELECT id,nickname,avatar,credit_score FROM users WHERE nickname=?').get(n);
  res.json(u ? { ok: true, user: u } : { ok: false });
});

app.get('/api/users/:id', (req, res) => {
  const u = getUser(req.params.id);
  if (!u) return res.status(404).json({ ok: false, error: '用户不存在' });
  const stats = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM posts WHERE user_id=?) AS posts,
       (SELECT COUNT(*) FROM posts WHERE accepted_by=?) AS helped,
       (SELECT COUNT(*) FROM comments WHERE user_id=?) AS comments`
  ).get(req.params.id, req.params.id, req.params.id);
  res.json({ ok: true, user: u, stats });
});

/* ============ 帖子 ============ */
app.get('/api/posts', async (req, res) => {
  const { category, status, q, mine, helped, me } = req.query;
  // 仅对「公开榜单」做缓存（带 me 的个人查询不缓存，避免串号）
  const isPublic = !me;
  const cacheKey = `posts:${category || ''}:${status || ''}:${q || ''}:${mine || ''}:${helped || ''}`;
  try {
    const rows = isPublic ? await getOrSet(cacheKey, 30, () => queryPosts({ category, status, q, mine, helped, me }))
                          : queryPosts({ category, status, q, mine, helped, me });
    res.json(rows.map(r => ({ ...r, tags: r.tags ? r.tags.split(',') : [] })));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

function queryPosts({ category, status, q, mine, helped, me }) {
  let cond = 'WHERE 1=1';
  const params = [];
  if (category && category !== '全部') { cond += ' AND p.category=?'; params.push(category); }
  if (status) { cond += ' AND p.status=?'; params.push(status); }
  if (q) { cond += ' AND (p.title LIKE ? OR p.content LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (mine && me) { cond += ' AND p.user_id=?'; params.push(me); }
  if (helped && me) { cond += ' AND p.accepted_by=?'; params.push(me); }
  return db.prepare(
    `SELECT p.id,p.title,p.content,p.category,p.reward,p.location,p.expected_time,p.status,p.view_count,p.created_at,
            u.nickname AS author,u.avatar AS author_avatar,u.credit_score AS author_credit,
            GROUP_CONCAT(t.tag) AS tags
     FROM posts p LEFT JOIN users u ON p.user_id=u.id
     LEFT JOIN post_tags t ON p.id=t.post_id
     ${cond} GROUP BY p.id ORDER BY p.created_at DESC LIMIT 50`
  ).all(...params);
}

app.post('/api/posts', authMiddleware, async (req, res) => {
  try {
    const body = { ...req.body, user_id: req.user.id };
    const r = await createPost(body);
    if (r.ok) {
      addNotification(req.user.id, 'post', '你的互助帖已通过审核并发布', r.post_id);
      cache.clear(); // 数据变更后失效列表缓存（演示用全清，生产按 key 精确失效）
    }
    res.json(r);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/posts/:id', (req, res) => {
  const p = postView(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: '帖子不存在' });
  const comments = db.prepare(
    `SELECT c.id,c.content,c.created_at,u.nickname,u.avatar,u.credit_score
     FROM comments c LEFT JOIN users u ON c.user_id=u.id WHERE c.post_id=? ORDER BY c.created_at ASC`
  ).all(req.params.id);
  db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id=?').run(req.params.id);
  const accepted = p.accepted_by ? getUser(p.accepted_by) : null;
  res.json({ ok: true, post: { ...p, tags: p.tags ? p.tags.split(',') : [] }, comments, accepted });
});

app.post('/api/posts/:id/accept', authMiddleware, (req, res) => {
  try {
    // 原子接单：条件更新 + 事务包住，并发下不会重复接单（防超卖同款）
    const r = claimPostAtomic(Number(req.params.id), req.user.id);
    if (!r.ok) return res.status(r.code || 400).json({ ok: false, error: r.error });
    addNotification(r.post.user_id, 'accept', `「${req.user.nickname}」接下了你的互助帖：「${r.post.title}」`, r.post.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/posts/:id/complete', authMiddleware, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: '帖子不存在' });
  if (p.status !== 'accepted') return res.status(400).json({ ok: false, error: '该帖未处于进行中' });
  if (p.user_id !== req.user.id && p.accepted_by !== req.user.id)
    return res.status(403).json({ ok: false, error: '只有发帖人或接单人可确认完成' });
  db.prepare('UPDATE posts SET status=? WHERE id=?').run('completed', p.id);
  changeCredit(p.accepted_by, 5);   // 接单人信用 +5
  incCompleted(p.accepted_by);
  changeCredit(p.user_id, 2);       // 发帖人信用 +2
  addNotification(p.accepted_by, 'complete', `互助已完成：「${p.title}」，信用 +5`, p.id);
  addNotification(p.user_id, 'complete', `互助已完成：「${p.title}」，信用 +2`, p.id);
  cache.clear();
  res.json({ ok: true });
});

app.post('/api/posts/:id/cancel', authMiddleware, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: '帖子不存在' });
  if (p.user_id !== req.user.id)
    return res.status(403).json({ ok: false, error: '只有发帖人可取消互助帖' });
  if (p.status !== 'open' && p.status !== 'accepted')
    return res.status(400).json({ ok: false, error: '该帖不可取消' });
  db.prepare('UPDATE posts SET status=? WHERE id=?').run('cancelled', p.id);
  if (p.status === 'accepted' && p.accepted_by) {
    addNotification(p.accepted_by, 'cancel', `「${p.title}」已被发帖人取消`, p.id);
  }
  res.json({ ok: true });
});

app.post('/api/posts/:id/comment', authMiddleware, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ ok: false, error: '评论内容不能为空' });
  if (content.trim().length > 500) return res.status(400).json({ ok: false, error: '评论内容不能超过 500 字' });
  const p = db.prepare('SELECT user_id,title FROM posts WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: '帖子不存在' });
  db.prepare('INSERT INTO comments(post_id,user_id,content) VALUES (?,?,?)').run(req.params.id, req.user.id, content.trim());
  if (p.user_id !== req.user.id) addNotification(p.user_id, 'comment', `${req.user.nickname} 评论了你的帖：「${p.title}」`, req.params.id);
  res.json({ ok: true });
});

/* ============ 智能推荐（Match Agent）============ */
app.get('/api/recommend', authMiddleware, async (req, res) => {
  try { res.json(await matchPosts(req.user)); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ============ AI 对话入口（Router 分发）============ */
app.post('/api/chat', authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ ok: false, error: '消息不能为空' });
    }
    db.prepare('INSERT INTO ai_messages(user_id,role,content) VALUES (?,?,?)').run(req.user.id, 'user', message);
    const route = await routeIntent(message);

    if (route.intent === 'post') {
      const post = await guidePost(message);
      if (post && post.missing && post.missing.length) {
        const reply = `已生成发帖草稿，还需补充：${post.missing.join('、')}。\n（可在下方直接补全重发完整需求，或到「发帖」页按草稿补全后发布）`;
        db.prepare('INSERT INTO ai_messages(user_id,role,content) VALUES (?,?,?)').run(req.user.id, 'assistant', reply);
        return res.json({ intent: 'post', reply, draft: post });
      }
      if (post) {
        // 规则兜底可能缺字段，这里统一再校验一次，避免发布半成品
        if (!post.title || !post.content) {
          const reply = '抱歉，我没能理解完整的发帖内容，请到「发帖」页补充标题和正文。';
          db.prepare('INSERT INTO ai_messages(user_id,role,content) VALUES (?,?,?)').run(req.user.id, 'assistant', reply);
          return res.json({ intent: 'post', reply, draft: post });
        }
        const r = await createPost({ ...post, user_id: req.user.id });
        const reply = r.ok ? `✅ 已为你发布互助帖：「${post.title}」` : `发布失败：${r.reason}`;
        db.prepare('INSERT INTO ai_messages(user_id,role,content) VALUES (?,?,?)').run(req.user.id, 'assistant', reply);
        return res.json({ intent: 'post', reply, result: r });
      }
    }
    if (route.intent === 'search') {
      const rows = await searchPosts(message);
      const reply = `为你找到 ${rows.length} 条相关帖子，已为你列出～`;
      db.prepare('INSERT INTO ai_messages(user_id,role,content) VALUES (?,?,?)').run(req.user.id, 'assistant', reply);
      return res.json({ intent: 'search', reply, results: rows });
    }
    if (route.intent === 'consult') {
      const reply = '📌 使用指引：①注册登录后到「发帖」发布互助需求（代拿/接课/寻物/二手/组队）；②在「广场」浏览或「检索」用自然语言找帖；③看到合适的点「接单」，完成后双方信用加分；④陌生交易注意安全，平台已对内容进行AI审核。';
      db.prepare('INSERT INTO ai_messages(user_id,role,content) VALUES (?,?,?)').run(req.user.id, 'assistant', reply);
      return res.json({ intent: 'consult', reply });
    }
    const reply = '你好呀～我可以帮你：① 一句话发帖（如「帮忙代拿外卖到3栋，报酬5元」）；② 找帖（如「有没有人明天帮我带饭」）；③ 解答平台使用问题。试试看？';
    db.prepare('INSERT INTO ai_messages(user_id,role,content) VALUES (?,?,?)').run(req.user.id, 'assistant', reply);
    return res.json({ intent: 'chat', reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/chat/history', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT role,content FROM ai_messages WHERE user_id=? ORDER BY id ASC').all(req.user.id);
  res.json(rows);
});

/* ============ 私信 ============ */
app.get('/api/dm/list', authMiddleware, (req, res) => {
  const rows = db.prepare(
    `SELECT other, nickname, avatar, last, unread FROM (
       SELECT CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END AS other,
              MAX(dm.id) AS mid
       FROM dm WHERE sender_id=? OR receiver_id=? GROUP BY other
     ) t
     JOIN dm ON dm.id=t.mid
     LEFT JOIN users u ON u.id=t.other
     ORDER BY t.mid DESC`
  ).all(req.user.id, req.user.id, req.user.id);
  // 补充未读 & 最后消息
  const list = rows.map(r => ({
    other: r.other,
    nickname: r.nickname, avatar: r.avatar,
    last: r.content, unread: db.prepare('SELECT COUNT(*) c FROM dm WHERE sender_id=? AND receiver_id=? AND `read`=0').get(r.other, req.user.id).c
  }));
  res.json(list);
});

app.get('/api/dm/:userId', authMiddleware, (req, res) => {
  const partner = getUser(req.params.userId);
  if (!partner) return res.status(404).json({ ok: false, error: '用户不存在' });
  const msgs = db.prepare(
    'SELECT sender_id, content, created_at FROM dm WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY id ASC'
  ).all(req.user.id, req.params.userId, req.params.userId, req.user.id);
  db.prepare('UPDATE dm SET `read`=1 WHERE sender_id=? AND receiver_id=?').run(req.params.userId, req.user.id);
  res.json({ ok: true, partner, messages: msgs });
});

app.post('/api/dm', authMiddleware, (req, res) => {
  const { receiver_id, content } = req.body;
  if (!receiver_id || !content || !content.trim()) return res.status(400).json({ ok: false, error: '收件人和内容不能为空' });
  if (content.trim().length > 2000) return res.status(400).json({ ok: false, error: '私信内容不能超过 2000 字' });
  if (receiver_id == req.user.id) return res.status(400).json({ ok: false, error: '不能给自己发私信' });
  const to = getUser(receiver_id);
  if (!to) return res.status(404).json({ ok: false, error: '收件人不存在' });
  db.prepare('INSERT INTO dm(sender_id,receiver_id,content) VALUES (?,?,?)').run(req.user.id, receiver_id, content.trim());
  addNotification(receiver_id, 'dm', `收到来自 ${req.user.nickname} 的私信`, req.user.id);
  res.json({ ok: true });
});

/* ============ 通知 ============ */
app.get('/api/notifications', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT id,type,content,related_id,`read`,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 40').all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND `read`=0').get(req.user.id).c;
  res.json({ ok: true, list: rows, unread });
});
app.post('/api/notifications/:id/read', authMiddleware, (req, res) => {
  db.prepare('UPDATE notifications SET `read`=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});
app.post('/api/notifications/read-all', authMiddleware, (req, res) => {
  db.prepare('UPDATE notifications SET `read`=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

/* ============ 平台运营统计（看板，带缓存）============ */
app.get('/api/stats', async (req, res) => {
  try {
    const data = await getOrSet('stats:global', 60, () => {
      const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
      const posts = db.prepare('SELECT COUNT(*) c FROM posts').get().c;
      const open = db.prepare("SELECT COUNT(*) c FROM posts WHERE status='open'").get().c;
      const accepted = db.prepare("SELECT COUNT(*) c FROM posts WHERE status='accepted'").get().c;
      const completed = db.prepare("SELECT COUNT(*) c FROM posts WHERE status='completed'").get().c;
      const comments = db.prepare('SELECT COUNT(*) c FROM comments').get().c;
      const dms = db.prepare('SELECT COUNT(*) c FROM dm').get().c;
      const notifs = db.prepare('SELECT COUNT(*) c FROM notifications').get().c;
      const views = db.prepare('SELECT COALESCE(SUM(view_count),0) v FROM posts').get().v;
      const byCategory = db.prepare('SELECT category, COUNT(*) c FROM posts GROUP BY category ORDER BY c DESC').all();
      const byStatus = db.prepare("SELECT status, COUNT(*) c FROM posts GROUP BY status").all();
      return { users, posts, open, accepted, completed, comments, dms, notifs, views, byCategory, byStatus };
    });
    res.json({ ok: true, ...data });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ============ 管理员后台（RBAC：仅 admin 角色）============ */
app.use('/api/admin', authMiddleware, requireRole('admin'));
app.get('/api/admin/users', (req, res) => {
  const list = db.prepare('SELECT id,nickname,role,credit_score,completed_count,created_at FROM users ORDER BY id').all();
  res.json({ ok: true, list });
});
app.get('/api/admin/audit', (req, res) => {
  const list = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 50').all();
  res.json({ ok: true, list });
});
app.post('/api/admin/users/:id/role', (req, res) => {
  const { role } = req.body;
  if (!['student', 'admin'].includes(role)) return res.status(400).json({ ok: false, error: '非法角色' });
  db.prepare('UPDATE users SET role=? WHERE id=?').run(role, req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/posts/:id/delete', (req, res) => {
  const r = db.prepare('DELETE FROM posts WHERE id=?').run(req.params.id);
  if (r.changes > 0) cache.clear();
  res.json({ ok: r.changes > 0 });
});

app.get('/api/top-helpers', (req, res) => {
  const list = db.prepare(
    'SELECT id,nickname,avatar,credit_score,completed_count FROM users ORDER BY completed_count DESC, credit_score DESC LIMIT 8'
  ).all();
  res.json({ ok: true, list });
});

// /api 未匹配路由统一返回 JSON 404，避免被 SPA 兜底吞掉
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: '接口不存在' });
});

/* ============ 静态托管前端构建 ============ */
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
// 缓存后端初始化：配置 REDIS_URL 则连真 Redis，连不上自动降级内存（ESM 顶层 await）
await initCache();
app.listen(PORT, () => console.log(`CampusWall backend running on :${PORT} (cache=${cacheBackend})`));
