// 鉴权模块：注册 / 登录 / JWT 双令牌（access + refresh）签发与校验 / RBAC 角色权限
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import db, {
  insertRefreshToken,
  getRefreshTokenRow,
  deleteRefreshToken,
  registerWithPhone,
  findIdentity,
  bindIdentity,
  getUserSecret,
  createVerifyCode,
  checkVerifyCode,
} from './db.js';
import { detectChannel } from './verify.js';

// 未配置 JWT_SECRET 时生成随机临时密钥，避免硬编码默认密钥被伪造；
// 重启后旧 token 会失效，正式/公网演示请在 .env 中配置固定 JWT_SECRET。
const SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
const ACCESS_TTL = process.env.ACCESS_TTL || '15m'; // access 短效，泄漏窗口小
const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TTL_DAYS || 7);
if (!process.env.JWT_SECRET) {
  console.warn('[auth] 未设置 JWT_SECRET，已使用随机临时密钥（重启后登录态失效）');
}

function signAccessToken(user) {
  return jwt.sign({ uid: user.id, nickname: user.nickname, role: user.role }, SECRET, { expiresIn: ACCESS_TTL });
}

// 签发一对令牌：短效 access + 长效 refresh（refresh 存库、可轮换/吊销）
export function issueTokens(user) {
  const access = signAccessToken(user);
  const refresh = randomBytes(40).toString('hex');
  insertRefreshToken(user.id, refresh, Date.now() + REFRESH_TTL_DAYS * 86400000);
  return { token: access, refreshToken: refresh, expiresIn: ACCESS_TTL };
}

// 用 refresh 换新的 access（refresh 无效/过期则报错，由调用方要求重新登录）
export function refreshAccessToken(refreshToken) {
  const row = getRefreshTokenRow(refreshToken);
  if (!row) throw new Error('refresh token 无效，请重新登录');
  if (new Date(row.expires_at).getTime() < Date.now()) {
    deleteRefreshToken(refreshToken);
    throw new Error('refresh token 已过期，请重新登录');
  }
  const user = db.prepare('SELECT id,nickname,role FROM users WHERE id=?').get(row.user_id);
  if (!user) throw new Error('用户不存在');
  return { token: signAccessToken(user), expiresIn: ACCESS_TTL };
}

// 登出：吊销当前 refresh（也可扩展为吊销该用户全部 refresh）
export function logout(refreshToken) {
  if (refreshToken) deleteRefreshToken(refreshToken);
  return { ok: true };
}

// Express 中间件：校验 Bearer access token
export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ ok: false, error: '请先登录' });
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = { id: payload.uid, nickname: payload.nickname, role: payload.role };
    next();
  } catch {
    res.status(401).json({ ok: false, error: '登录已过期，请重新登录' });
  }
}

// RBAC：要求指定角色（如 'admin'），否则 403
export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ ok: false, error: '权限不足，需要管理员身份' });
    }
    next();
  };
}

export function register({ nickname, password, school, grade }) {
  if (!nickname || !password) throw new Error('昵称和密码不能为空');
  nickname = String(nickname || '').trim();
  if (!nickname) throw new Error('昵称不能为空');
  if (nickname.length > 20) throw new Error('昵称长度不能超过 20 个字符');
  if (password.length < 6) throw new Error('密码至少 6 位');
  if (password.length > 72) throw new Error('密码长度不能超过 72 位');
  const exists = db.prepare('SELECT id FROM users WHERE nickname=?').get(nickname);
  if (exists) throw new Error('该昵称已被注册');
  const hash = bcrypt.hashSync(password, 8);
  const avatars = ['🦌', '🐯', '🌟', '🐱', '🦊', '🐼', '🚀', '🍀'];
  const avatar = avatars[Math.floor(Math.random() * avatars.length)];
  const id = db.prepare(
    'INSERT INTO users(nickname,password_hash,school,grade,avatar,role) VALUES (?,?,?,?,?,?)'
  ).run(nickname, hash, school || '', grade || '', avatar, 'student').lastInsertRowid;
  const user = db.prepare('SELECT id,nickname,school,grade,avatar,credit_score,completed_count,role FROM users WHERE id=?').get(id);
  return { ok: true, ...issueTokens(user), user };
}

export function login({ nickname, password }) {
  if (!nickname || !password) throw new Error('昵称和密码不能为空');
  nickname = String(nickname || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE nickname=?').get(nickname);
  if (!user) throw new Error('用户不存在');
  if (!bcrypt.compareSync(password, user.password_hash)) throw new Error('密码错误');
  if (user.is_active === 0) throw new Error('账号已被禁用');
  const safe = {
    id: user.id, nickname: user.nickname, school: user.school, grade: user.grade,
    avatar: user.avatar, credit_score: user.credit_score,
    completed_count: user.completed_count, role: user.role,
  };
  return { ok: true, ...issueTokens(safe), user: safe };
}

/* ============ 手机号注册 / 登录 ============ */
export function phoneRegister({ phone, password, nickname }) {
  const user = registerWithPhone(phone, password, nickname);
  return { ok: true, ...issueTokens(user), user };
}
export function phoneLogin({ phone, password }) {
  if (!phone || !password) throw new Error('手机号和密码不能为空');
  const ident = findIdentity('phone', phone);
  if (!ident) throw new Error('该手机号未注册');
  const user = getUserSecret(ident.user_id);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) throw new Error('手机号或密码错误');
  if (user.is_active === 0) throw new Error('账号已被禁用');
  const safe = {
    id: user.id, nickname: user.nickname, school: user.school, grade: user.grade,
    avatar: user.avatar, credit_score: user.credit_score,
    completed_count: user.completed_count, role: user.role,
  };
  return { ok: true, ...issueTokens(safe), user: safe };
}

/* ============ 第三方 OAuth（微信 / QQ）脚手架 ============ */
async function codeToOpenid(provider, code) {
  const appid = process.env[provider === 'wechat' ? 'WECHAT_APPID' : 'QQ_APPID'];
  const secret = process.env[provider === 'wechat' ? 'WECHAT_SECRET' : 'QQ_SECRET'];
  if (!appid || !secret || !code) return code; // 未配置 → mock（code 当 openid）
  try {
    const url = provider === 'wechat'
      ? `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appid}&secret=${secret}&code=${code}&grant_type=authorization_code`
      : `https://graph.qq.com/oauth2.0/token?grant_type=authorization_code&client_id=${appid}&client_secret=${secret}&code=${code}&redirect_uri=${process.env.QQ_REDIRECT || ''}`;
    const r = await fetch(url);
    const d = await r.json();
    return d.openid;
  } catch {
    return code;
  }
}
/**
 * 第三方登录（微信 / QQ 扫码）
 * 已绑定过 → 直接登录；首次使用 → 必须先用「手机号或邮箱 + 验证码」完成验证，才允许建号并绑定第三方。
 */
export async function oauthLogin(provider, code, target, verifyCode) {
  if (!['wechat', 'qq'].includes(provider)) return { ok: false, error: '不支持的第三方' };
  const openid = await codeToOpenid(provider, code);
  if (!openid) return { ok: false, needBind: true, error: '授权失败，请重新扫码' };

  const ident = findIdentity(provider, openid);
  if (ident) {
    // 该微信/QQ 已绑定过 → 直接登录
    const u = db.prepare('SELECT id,nickname,school,grade,avatar,credit_score,completed_count,role FROM users WHERE id=?').get(ident.user_id);
    return { ok: true, ...issueTokens(u), user: u };
  }

  // 首次扫码：要求验证手机号或邮箱
  if (!target || !verifyCode) {
    return {
      ok: false,
      needBind: true,
      provider,
      openid,
      error: '首次使用微信/QQ 登录，请先绑定手机号或邮箱完成验证',
    };
  }
  const channel = detectChannel(target);
  if (!channel) return { ok: false, needBind: true, error: '请输入正确的手机号或邮箱' };
  const v = checkVerifyCode(target, verifyCode, 'third_login');
  if (!v.ok) return { ok: false, needBind: true, error: v.error };

  // 该手机号/邮箱若已属于某个账号 → 直接复用，再挂上第三方；否则新注册
  const exist = findIdentity(channel, target);
  let uid;
  if (exist) {
    uid = exist.user_id;
  } else {
    const avatars = ['🦌', '🐯', '🌟', '🐱', '🦊', '🐼', '🚀', '🍀'];
    const avatar = avatars[Math.floor(Math.random() * avatars.length)];
    uid = db
      .prepare('INSERT INTO users(nickname,password_hash,avatar,role) VALUES (?,?,?,?)')
      .run(
        `${provider === 'wechat' ? '微信' : 'QQ'}用户${String(openid).slice(0, 4)}`,
        bcrypt.hashSync(randomBytes(12).toString('hex'), 8),
        avatar,
        'student'
      ).lastInsertRowid;
  }
  bindIdentity(uid, channel, target);
  bindIdentity(uid, provider, openid);
  const u = db.prepare('SELECT id,nickname,school,grade,avatar,credit_score,completed_count,role FROM users WHERE id=?').get(uid);
  return { ok: true, ...issueTokens(u), user: u };
}

/** 已登录用户绑定手机号/邮箱（需先通过验证码验证） */
export function bindContact(userId, target, verifyCode) {
  const channel = detectChannel(target);
  if (!channel) return { ok: false, error: '请输入正确的手机号或邮箱' };
  const v = checkVerifyCode(target, verifyCode, 'bind');
  if (!v.ok) return { ok: false, error: v.error };
  if (findIdentity(channel, target)) {
    return { ok: false, error: channel === 'email' ? '该邮箱已被绑定' : '该手机号已被绑定' };
  }
  bindIdentity(userId, channel, target);
  return { ok: true, channel };
}

export function bindCurrentUser(userId, provider, externalId) {
  bindIdentity(userId, provider, externalId);
  return { ok: true };
}
