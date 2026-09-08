import React, { useState, useEffect, useCallback } from 'react';
import { AppContext } from './ctx.js';
import { api, getToken, setToken } from './api.js';
import Auth from './components/Auth.jsx';
import Sidebar from './components/Sidebar.jsx';
import Plaza from './components/Plaza.jsx';
import Publish from './components/Publish.jsx';
import Search from './components/Search.jsx';
import Assistant from './components/Assistant.jsx';
import Dashboard from './components/Dashboard.jsx';
import Messages from './components/Messages.jsx';
import Notifications from './components/Notifications.jsx';
import Profile from './components/Profile.jsx';
import PostDetail from './components/PostDetail.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState('plaza');
  const [detailId, setDetailId] = useState(null);
  const [notifUnread, setNotifUnread] = useState(0);
  const [dmUnread, setDmUnread] = useState(0);

  const refreshBadges = useCallback(async () => {
    try {
      const n = await api.notifications();
      setNotifUnread(n.unread || 0);
    } catch {}
    try {
      const list = await api.dmList();
      setDmUnread(list.reduce((s, x) => s + (x.unread || 0), 0));
    } catch {}
  }, []);

  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api.me().then(r => {
      if (r.ok) setUser(r.user);
    }).catch(() => setToken('')).finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (user) refreshBadges();
  }, [user, refreshBadges]);

  async function handleLogin(result) {
    setToken(result.token);
    setUser(result.user);
    setView('plaza');
    await refreshBadges();
  }
  function handleLogout() {
    setToken('');
    setUser(null);
    setView('plaza');
  }

  if (!ready) return <div className="loading">加载中…</div>;
  if (!user) return <Auth onAuth={handleLogin} />;

  const ctx = {
    user, setUser, view, setView,
    detailId, setDetailId,
    notifUnread, dmUnread, refreshBadges, handleLogout,
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="layout">
        <Sidebar />
        <main className="main">
          {view === 'plaza' && <Plaza />}
          {view === 'publish' && <Publish />}
          {view === 'search' && <Search />}
          {view === 'assistant' && <Assistant />}
          {view === 'dashboard' && <Dashboard />}
          {view === 'messages' && <Messages onBack={() => setView('plaza')} />}
          {view === 'notifications' && <Notifications />}
          {view === 'profile' && <Profile />}
        </main>
        {detailId && <PostDetail id={detailId} onClose={() => setDetailId(null)} />}
      </div>
    </AppContext.Provider>
  );
}
