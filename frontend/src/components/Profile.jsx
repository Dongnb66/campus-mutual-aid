import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../ctx.js';
import { api } from '../api.js';

const STATUS_TEXT = { open: '待接单', accepted: '进行中', completed: '已完成', cancelled: '已取消' };

export default function Profile() {
  const { user, setUser, handleLogout, setDetailId } = useApp();
  const [tab, setTab] = useState('mine'); // mine | helped
  const [posts, setPosts] = useState([]);

  const load = useCallback(async (currentTab) => {
    try {
      const params = currentTab === 'helped'
        ? { helped: '1', me: user.id }
        : { mine: '1', me: user.id };
      const data = await api.getPosts(params);
      setPosts(data);
    } catch (e) { alert(e.message); }
  }, [user.id]);

  useEffect(() => { load(tab); }, [tab, load]);

  // 信用等级
  const credit = user.credit_score;
  const level = credit >= 120 ? '值得信赖 ⭐⭐⭐' : credit >= 100 ? '信用良好 ⭐⭐' : credit >= 80 ? '信用一般 ⭐' : '需积累 ⚠️';

  return (
    <div className="page">
      <header className="page-head"><h2>我的</h2></header>

      <div className="profile-card">
        <span className="avatar lg">{user.avatar}</span>
        <div className="profile-main">
          <div className="profile-name">{user.nickname}</div>
          <div className="profile-sub">{user.school || '未填写学院'} · {user.grade || '未填写年级'}</div>
          <div className="profile-sub">信用 {user.credit_score} · 已完成互助 {user.completed_count} 次</div>
        </div>
      </div>

      <div className="credit-box">
        <div className="credit-num">{credit}</div>
        <div className="credit-label">信用分 · {level}</div>
        <div className="credit-stat">已完成互助 {user.completed_count} 次</div>
      </div>

      <div className="auth-tabs small">
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>我发布的</button>
        <button className={tab === 'helped' ? 'on' : ''} onClick={() => setTab('helped')}>我接的单</button>
      </div>

      <div className="feed">
        {posts.length === 0 && <div className="empty">还没有内容～</div>}
        {posts.map(p => (
          <div className="pcard" key={p.id} onClick={() => setDetailId(p.id)}>
            <div className="pcard-top"><span className="pcat">{p.category}</span>
              <span className="pstatus">● {STATUS_TEXT[p.status] || p.status}</span></div>
            <h3>{p.title}</h3><p className="pcontent">{p.content}</p>
          </div>
        ))}
      </div>

      <button className="logout-btn" onClick={handleLogout}>退出登录</button>
    </div>
  );
}
