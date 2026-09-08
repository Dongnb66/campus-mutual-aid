// 鉴权模块：注册 / 登录 / JWT 签发与校验
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import db from './db.js';

// 未配置 JWT_SECRET 时生成随机临时密钥，避免硬编码默认密钥被伪造；
// 重启后旧 token 会失效，正式/公网演示请在 .env 中配置固定 JWT_SECRET。
const SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('[auth] 未设置 JWT_SECRET，已使用随机临时密钥（重启后登录态失效）');
}

export function signToken(user) {
  return jwt.sign({ uid: user.id, nickname: user.nickname }, SECRET, { expiresIn: '7d' });
}

// Express 中间件：校验 Bearer Token
export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ ok: false, error: '请先登录' });
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = { id: payload.uid, nickname: payload.nickname };
    next();
  } catch {
    res.status(401).json({ ok: false, error: '登录已过期，请重新登录' });
  }
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
    'INSERT INTO users(nickname,password_hash,school,grade,avatar) VALUES (?,?,?,?,?)'
  ).run(nickname, hash, school || '', grade || '', avatar).lastInsertRowid;
  const user = db.prepare('SELECT id,nickname,school,grade,avatar,credit_score,completed_count FROM users WHERE id=?').get(id);
  return { ok: true, token: signToken(user), user };
}

export function login({ nickname, password }) {
  if (!nickname || !password) throw new Error('昵称和密码不能为空');
  nickname = String(nickname || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE nickname=?').get(nickname);
  if (!user) throw new Error('用户不存在');
  if (!bcrypt.compareSync(password, user.password_hash)) throw new Error('密码错误');
  const safe = { id: user.id, nickname: user.nickname, school: user.school, grade: user.grade, avatar: user.avatar, credit_score: user.credit_score, completed_count: user.completed_count };
  return { ok: true, token: signToken(safe), user: safe };
}
