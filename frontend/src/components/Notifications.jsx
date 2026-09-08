import React, { useState, useEffect } from 'react';
import { useApp } from '../ctx.js';
import { api } from '../api.js';

const TYPE_ICON = { post: '📝', accept: '🤝', complete: '✅', cancel: '🚫', comment: '💬', dm: '💌' };

export default function Notifications() {
  const { refreshBadges, setDetailId, setView } = useApp();
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { const d = await api.notifications(); setList(d.list); await refreshBadges(); } catch (e) { alert(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function readOne(id) {
    await api.readNotification(id).catch(() => {});
    setList(l => l.map(n => n.id === id ? { ...n, read: 1 } : n));
    await refreshBadges();
  }
  async function readAll() {
    setBusy(true);
    try { await api.readAllNotifications(); setList(l => l.map(n => ({ ...n, read: 1 }))); await refreshBadges(); }
    catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  function onItem(n) {
    readOne(n.id);
    if (n.type === 'dm') { setView('messages'); return; }
    if (n.related_id) setDetailId(n.related_id);
  }

  return (
    <div className="page">
      <header className="page-head"><h2>通知</h2>
        <p className="page-sub">接单、完成、评论、私信都会在这里提醒你</p></header>
      <div className="notif-actions">
        <button onClick={readAll} disabled={busy}>全部标为已读</button>
      </div>
      {list.length === 0 && <div className="empty">暂无通知</div>}
      <div className="notif-list">
        {list.map(n => (
          <div key={n.id} className={`notif ${n.read ? 'read' : ''}`} onClick={() => onItem(n)}>
            <span className="notif-ico">{TYPE_ICON[n.type] || '🔔'}</span>
            <div className="notif-body">
              <div className="notif-text">{n.content}</div>
              <div className="notif-time">{new Date(n.created_at).toLocaleString('zh-CN')}</div>
            </div>
            {!n.read && <span className="dot" />}
          </div>
        ))}
      </div>
    </div>
  );
}
