import React, { useState } from 'react';
import { api } from '../api.js';

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState('login'); // login | register
  const [form, setForm] = useState({ nickname: '', password: '', school: '', grade: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = mode === 'login'
        ? await api.login({ nickname: form.nickname, password: form.password })
        : await api.register(form);
      if (!r.ok) { setErr(r.error || '操作失败'); return; }
      onAuth(r);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <div className="brand-logo">🦌</div>
          <h1>校园互助墙</h1>
          <p>多智能体增强 · 让校园里的每一次求助都被看见</p>
        </div>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setErr(''); }}>登录</button>
          <button className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setErr(''); }}>注册</button>
        </div>

        <form onSubmit={submit} className="auth-form">
          <input placeholder="昵称" value={form.nickname} onChange={e => set('nickname', e.target.value)} required />
          <input placeholder="密码（至少6位）" type="password" value={form.password} onChange={e => set('password', e.target.value)} required />
          {mode === 'register' && (
            <>
              <input placeholder="学院（选填）" value={form.school} onChange={e => set('school', e.target.value)} />
              <input placeholder="年级（选填，如 大二）" value={form.grade} onChange={e => set('grade', e.target.value)} />
            </>
          )}
          {err && <div className="err">{err}</div>}
          <button type="submit" disabled={busy}>{busy ? '处理中…' : (mode === 'login' ? '登录' : '注册并进入')}</button>
        </form>

        <div className="auth-tip">
          演示账号：<b>小鹿 / 123456</b>、<b>阿杰 / 123456</b>、<b>学委 / 123456</b>（已内置示例数据）
        </div>
      </div>
    </div>
  );
}
