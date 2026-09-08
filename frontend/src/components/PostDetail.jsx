import React, { useState, useEffect } from 'react';
import { useApp } from '../ctx.js';
import { api } from '../api.js';

const STATUS_COLOR = { open: '#16a34a', accepted: '#f59e0b', completed: '#94a3b8', cancelled: '#cbd5e1' };
const STATUS_TEXT = { open: '待接单', accepted: '进行中', completed: '已完成', cancelled: '已取消' };

export default function PostDetail({ id, onClose }) {
  const { user, setUser, refreshBadges } = useApp();
  const [data, setData] = useState(null);
  const [comment, setComment] = useState('');
  const [dmOpen, setDmOpen] = useState(false);
  const [dmText, setDmText] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setData(await api.getPost(id)); } catch (e) { alert(e.message); }
  }
  useEffect(() => { load(); }, [id]);

  async function accept() {
    setBusy(true);
    try { await api.acceptPost(id); await load(); await refreshBadges(); }
    catch (e) { alert(e.message); } finally { setBusy(false); }
  }
  async function complete() {
    setBusy(true);
    try {
      await api.completePost(id);
      await load();
      await refreshBadges();
      const r = await api.me();
      if (r.ok && r.user) setUser(r.user);
    }
    catch (e) { alert(e.message); } finally { setBusy(false); }
  }
  async function cancel() {
    if (!window.confirm('确定取消这条互助帖吗？')) return;
    setBusy(true);
    try { await api.cancelPost(id); await load(); await refreshBadges(); }
    catch (e) { alert(e.message); } finally { setBusy(false); }
  }
  async function addComment(e) {
    e.preventDefault();
    if (!comment.trim()) return;
    try { await api.commentPost(id, comment.trim()); setComment(''); await load(); }
    catch (e) { alert(e.message); }
  }
  async function sendDm() {
    if (!dmText.trim()) return;
    try {
      await api.sendDm(data.post.user_id, dmText.trim());
      setDmText(''); setDmOpen(false); await refreshBadges();
      alert('私信已发送');
    } catch (e) { alert(e.message); }
  }

  if (!data) return <div className="modal-mask" onClick={onClose}><div className="modal"><div className="muted">加载中…</div></div></div>;

  const p = data.post;
  const isMine = p.user_id === user.id;
  const isAcceptedByMe = p.accepted_by === user.id;

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-cat"><span className="pcat">{p.category}</span>
          <span className="pstatus" style={{ color: STATUS_COLOR[p.status] }}>● {STATUS_TEXT[p.status]}</span></div>
        <h2 className="modal-title">{p.title}</h2>

        <div className="author-row">
          <span className="avatar">{p.author_avatar}</span>
          <div>
            <div className="aname">{p.author} <span className="acredit">信用 {p.author_credit}</span></div>
            {p.author_grade && <div className="asub">{p.author_grade}</div>}
          </div>
        </div>

        <p className="modal-content">{p.content}</p>
        <div className="kv">
          {p.reward && p.reward !== '—' && <div>💰 报酬：<b>{p.reward}</b></div>}
          {p.location && <div>📍 地点：{p.location}</div>}
          {p.expected_time && <div>⏰ 期望：{p.expected_time}</div>}
          {p.contact && <div>📞 联系：{p.contact}</div>}
          <div>👁 浏览：{p.view_count}</div>
        </div>

        {p.status === 'accepted' && data.accepted && (
          <div className="accepted-by">接单人：{data.accepted.avatar} {data.accepted.nickname}（信用 {data.accepted.credit_score}）</div>
        )}

        <div className="action-row">
          {p.status === 'open' && !isMine && <button className="btn-primary" disabled={busy} onClick={accept}>🤝 我来接单</button>}
          {p.status === 'accepted' && (isMine || isAcceptedByMe) && <button className="btn-primary" disabled={busy} onClick={complete}>✅ 确认完成</button>}
          {isMine && (p.status === 'open' || p.status === 'accepted') && <button className="btn-ghost" disabled={busy} onClick={cancel}>🚫 取消互助</button>}
          {!isMine && <button className="btn-ghost" onClick={() => setDmOpen(v => !v)}>💬 私信 TA</button>}
          {isMine && <span className="muted small">这是你发布的帖</span>}
        </div>

        {dmOpen && !isMine && (
          <div className="dm-inline">
            <textarea placeholder={`给 ${p.author} 留言…`} value={dmText} onChange={e => setDmText(e.target.value)} />
            <button onClick={sendDm}>发送私信</button>
          </div>
        )}

        <div className="comments">
          <div className="comments-title">💬 评论 {data.comments.length}</div>
          {data.comments.length === 0 && <div className="muted small">还没有评论，来抢沙发～</div>}
          {data.comments.map(c => (
            <div className="comment" key={c.id}>
              <span className="avatar sm">{c.avatar}</span>
              <div><b>{c.nickname}</b> <span className="ccredit">信用{c.credit_score}</span>
                <div>{c.content}</div></div>
            </div>
          ))}
          <form onSubmit={addComment} className="comment-form">
            <input placeholder="说点什么…" value={comment} onChange={e => setComment(e.target.value)} />
            <button type="submit">发送</button>
          </form>
        </div>
      </div>
    </div>
  );
}
