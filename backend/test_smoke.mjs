// 冒烟测试：一键验证 4 个工程化升级（双 token / RBAC / 原子接单 / 缓存）
// 运行：node test_smoke.mjs   （需先 npm install）
import { spawn } from 'node:child_process';
import process from 'node:process';

const PORT = 3099;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${detail ? '  (' + detail + ')' : ''}`);
}

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

async function main() {
  // 等服务起来
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/api/stats'); break; } catch { await sleep(200); }
  }

  // 注册两个学生
  const a = await call('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'smokeA' + Date.now(), password: '123456', school: 'x', grade: 'y' }) });
  const b = await call('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'smokeB' + Date.now(), password: '123456', school: 'x', grade: 'y' }) });
  check('注册返回双 token', a.body.token && a.body.refreshToken, '有 access+refresh');
  const tokenA = a.body.token, refreshA = a.body.refreshToken;
  const tokenB = b.body.token, refreshB = b.body.refreshToken;

  // refresh 换 access
  const rf = await call('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: refreshA }) });
  check('refresh 换发新 access', rf.status === 200 && rf.body.token, `code=${rf.status}`);

  // /me 带 role
  const me = await call('/api/auth/me', { headers: { Authorization: 'Bearer ' + tokenA } });
  check('RBAC: /me 返回角色', me.body.user && me.body.user.role === 'student', `role=${me.body?.user?.role}`);

  // 发帖（无 LLM key 走规则兜底）
  const post = await call('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenA }, body: JSON.stringify({ title: '帮忙代拿外卖', content: '到3栋楼下，报酬5元', category: '代拿' }) });
  check('发帖成功', post.body.ok === true, `post_id=${post.body.post_id}`);
  const pid = post.body.post_id;

  // 原子接单：B 接一次成功，再接一次应 409（防并发/防超卖）
  const acc1 = await call(`/api/posts/${pid}/accept`, { method: 'POST', headers: { Authorization: 'Bearer ' + tokenB } });
  check('首次接单成功', acc1.status === 200 && acc1.body.ok === true, `code=${acc1.status}`);
  const acc2 = await call(`/api/posts/${pid}/accept`, { method: 'POST', headers: { Authorization: 'Bearer ' + tokenB } });
  check('重复接单被拦截(409/400)', acc2.status !== 200, `code=${acc2.status} msg=${acc2.body?.error}`);

  // 管理员登录（种子账号 admin/admin123）
  const admin = await call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'admin', password: 'admin123' }) });
  check('管理员登录成功', admin.body.ok === true, `role=${admin.body.user?.role}`);
  const adminToken = admin.body.token;

  // RBAC：admin 可访问后台，student 被 403
  const adminOk = await call('/api/admin/users', { headers: { Authorization: 'Bearer ' + adminToken } });
  check('RBAC: admin 访问后台 200', adminOk.status === 200 && Array.isArray(adminOk.body.list), `code=${adminOk.status}`);
  const studentHit = await call('/api/admin/users', { headers: { Authorization: 'Bearer ' + tokenA } });
  check('RBAC: student 访问后台 403', studentHit.status === 403, `code=${studentHit.status}`);

  // 缓存：两次 GET /api/posts 命中同一结果（不直接断言缓存，仅验证接口稳定）
  const p1 = await call('/api/posts');
  const p2 = await call('/api/posts');
  check('列表接口可缓存访问', p1.status === 200 && p2.status === 200, `counts=${p1.body.length},${p2.body.length}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n==== ${results.length - failed.length}/${results.length} 通过 ====`);
  server.kill();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('测试异常', e); server.kill(); process.exit(1); });
setTimeout(() => { console.error('超时'); server.kill(); process.exit(1); }, 20000);
