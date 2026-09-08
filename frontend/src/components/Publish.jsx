import React, { useState } from 'react';
import { useApp } from '../ctx.js';
import { api } from '../api.js';

const CATS = ['代拿', '接课', '寻物', '二手', '组队', '其他'];

export default function Publish() {
  const { setView, refreshBadges } = useApp();
  const [mode, setMode] = useState('ai'); // ai | manual
  const [form, setForm] = useState({ title: '', content: '', category: '代拿', reward: '', location: '', expected_time: '', contact: '' });
  const [aiText, setAiText] = useState('');
  const [aiReply, setAiReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function aiSubmit(e) {
    e.preventDefault();
    if (!aiText.trim()) return;
    setBusy(true); setMsg('');
    try {
      const r = await api.chat(aiText);
      if (r.intent === 'post' && r.result && r.result.ok) {
        setAiReply('✅ ' + r.reply);
        setAiText('');
        await refreshBadges();
        setTimeout(() => setView('plaza'), 1200);
      } else if (r.intent === 'post' && r.draft) {
        const d = r.draft || {};
        // 信息不全时：把 AI 草稿带入手动表单，由用户补全后发布，避免“假闭环”
        setForm(f => ({
          ...f,
          title: f.title || d.title || '',
          content: f.content || d.content || aiText,
          category: CATEGORIES.includes(d.category) ? d.category : f.category,
          reward: f.reward || d.reward || '',
          location: f.location || d.location || '',
          expected_time: f.expected_time || d.expected_time || '',
          contact: f.contact || d.contact || ''
        }));
        setMode('manual');
        setAiText('');
        setAiReply('🤖 ' + r.reply);
      } else {
        setAiReply('🤖 ' + (r.reply || JSON.stringify(r)));
      }
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  async function manualSubmit(e) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const r = await api.createPost(form);
      if (!r.ok) { setMsg(r.reason || '发布失败'); return; }
      setForm({ title: '', content: '', category: '代拿', reward: '', location: '', expected_time: '', contact: '' });
      await refreshBadges();
      setMsg('发布成功！');
      setTimeout(() => setView('plaza'), 1000);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <header className="page-head"><h2>发布互助</h2>
        <p className="page-sub">🤖 多智能体会自动审核内容、识别分类</p></header>

      <div className="auth-tabs small">
        <button className={mode === 'ai' ? 'on' : ''} onClick={() => setMode('ai')}>✨ 一句话智能发帖</button>
        <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>✍️ 手动填写</button>
      </div>

      {mode === 'ai' ? (
        <form onSubmit={aiSubmit} className="publish-ai">
          <textarea placeholder="例如：明早8点帮我代拿顺丰快递到5栋，报酬5元，微信联系" value={aiText} onChange={e => setAiText(e.target.value)} />
          <button type="submit" disabled={busy}>{busy ? '处理中…' : '智能发布'}</button>
          {aiReply && <pre className="ai-reply">{aiReply}</pre>}
        </form>
      ) : (
        <form onSubmit={manualSubmit} className="publish-form">
          <input placeholder="标题" value={form.title} onChange={e => set('title', e.target.value)} required />
          <textarea placeholder="详细描述你的需求…" value={form.content} onChange={e => set('content', e.target.value)} required />
          <div className="grid2">
            <select value={form.category} onChange={e => set('category', e.target.value)}>
              {CATS.map(c => <option key={c}>{c}</option>)}
            </select>
            <input placeholder="报酬（如 5元 / 一杯奶茶）" value={form.reward} onChange={e => set('reward', e.target.value)} />
            <input placeholder="地点（如 3栋 / 图书馆）" value={form.location} onChange={e => set('location', e.target.value)} />
            <input placeholder="期望时间（如 今天17点）" value={form.expected_time} onChange={e => set('expected_time', e.target.value)} />
          </div>
          <input placeholder="联系方式（微信/QQ，选填）" value={form.contact} onChange={e => set('contact', e.target.value)} />
          <button type="submit" disabled={busy}>{busy ? 'AI审核中…' : '发布（AI审核 + 自动分类）'}</button>
        </form>
      )}
      {msg && <div className="ok-msg">{msg}</div>}
    </div>
  );
}
