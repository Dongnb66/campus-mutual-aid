import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../ctx.js';
import { api } from '../api.js';

export default function Messages() {
  const { user, refreshBadges } = useApp();
  const [list, setList] = useState([]);
  const [active, setActive] = useState(null); // {id, nickname, avatar}
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    try { const l = await api.dmList(); setList(l); await refreshBadges(); } catch {}
  }, [refreshBadges]);

  useEffect(() => { loadList(); }, [loadList]);

  async function openConv(u) {
    setActive(u);
    try {
      const d = await api.dmConversation(u.other);
      setMsgs(d.messages);
      setActive({ id: u.other, nickname: u.nickname, avatar: u.avatar });
    } catch (e) { alert(e.message); }
  }

  async function send() {
    if (!active || !text.trim() || busy) return;
    setBusy(true);
    try {
      await api.sendDm(active.id, text.trim());
      setText('');
      const d = await api.dmConversation(active.id);
      setMsgs(d.messages);
      await loadList();
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  async function startNew(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const r = await api.findUser(newName.trim());
      if (!r.ok) { alert('未找到该用户'); return; }
      setNewName('');
      openConv({ other: r.user.id, nickname: r.user.nickname, avatar: r.user.avatar });
    } catch (e) { alert(e.message); }
  }

  return (
    <div className="page dm-page">
      <header className="page-head"><h2>私信</h2>
        <p className="page-sub">🔒 仅在双方之间，沟通互助细节更安心</p></header>

      <div className="dm-layout">
        <div className="dm-list">
          <form onSubmit={startNew} className="dm-new">
            <input placeholder="输入昵称发起新私信" value={newName} onChange={e => setNewName(e.target.value)} />
            <button type="submit">＋</button>
          </form>
          {list.length === 0 && <div className="muted small">还没有私信，去帖子详情里「私信 TA」试试</div>}
          {list.map(u => (
            <div key={u.other} className={`dm-item ${active && active.id === u.other ? 'on' : ''}`} onClick={() => openConv(u)}>
              <span className="avatar">{u.avatar}</span>
              <div className="dm-item-main">
                <div className="dm-name">{u.nickname}</div>
                <div className="dm-last">{u.last}</div>
              </div>
              {u.unread > 0 && <span className="nav-badge">{u.unread}</span>}
            </div>
          ))}
        </div>

        <div className="dm-conv">
          {!active ? <div className="muted center">选择一个会话开始聊天</div> : (
            <>
              <div className="dm-conv-head">{active.avatar} {active.nickname}</div>
              <div className="dm-messages">
                {msgs.map((m, i) => (
                  <div key={i} className={m.sender_id === user.id ? 'bubble me' : 'bubble bot'}>
                    <span>{m.content}</span>
                  </div>
                ))}
              </div>
              <div className="chat-input">
                <input placeholder="输入消息…" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
                <button onClick={send} disabled={busy}>{busy ? '…' : '发送'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
