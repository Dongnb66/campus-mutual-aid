import React from 'react';
import { useApp } from '../ctx.js';

const NAV = [
  { key: 'plaza', icon: '🏠', label: '广场' },
  { key: 'publish', icon: '➕', label: '发帖' },
  { key: 'search', icon: '🔍', label: '检索' },
  { key: 'assistant', icon: '🤖', label: '助手' },
  { key: 'dashboard', icon: '📊', label: '统计' },
  { key: 'messages', icon: '💬', label: '消息', badge: 'dmUnread' },
  { key: 'notifications', icon: '🔔', label: '通知', badge: 'notifUnread' },
  { key: 'profile', icon: '👤', label: '我的' },
];

export default function Sidebar() {
  const { user, view, setView, notifUnread, dmUnread } = useApp();
  const badges = { notifUnread, dmUnread };

  return (
    <aside className="sidebar">
      <div className="side-brand">
        <span className="side-logo">🦌</span>
        <div>
          <div className="side-title">校园互助墙</div>
          <div className="side-sub">多智能体增强</div>
        </div>
      </div>

      <nav className="side-nav">
        {NAV.map(n => (
          <button key={n.key} className={view === n.key ? 'on' : ''} onClick={() => setView(n.key)}>
            <span className="nav-ico">{n.icon}</span>
            <span>{n.label}</span>
            {n.badge && badges[n.badge] > 0 && <span className="nav-badge">{badges[n.badge]}</span>}
          </button>
        ))}
      </nav>

      <div className="side-user" onClick={() => setView('profile')}>
        <span className="avatar">{user.avatar}</span>
        <div>
          <div className="uname">{user.nickname}</div>
          <div className="ucredit">信用 {user.credit_score}</div>
        </div>
      </div>
    </aside>
  );
}
