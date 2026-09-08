import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../ctx.js';
import { api } from '../api.js';

const CATS = ['全部', '代拿', '接课', '寻物', '二手', '组队', '其他'];
const STATUS = { all: '全部', open: '待接单', accepted: '进行中', completed: '已完成', cancelled: '已取消' };

const STATUS_COLOR = { open: '#16a34a', accepted: '#f59e0b', completed: '#94a3b8', cancelled: '#cbd5e1' };

function PostCard({ p, onClick }) {
  return (
    <div className="pcard" onClick={onClick}>
      <div className="pcard-top">
        <span className="pcat">{p.category}</span>
        <span className="pstatus" style={{ color: STATUS_COLOR[p.status] }}>● {STATUS[p.status] || p.status}</span>
      </div>
      <h3>{p.title}</h3>
      <p className="pcontent">{p.content}</p>
      <div className="pmeta">
        <span>{p.author_avatar} {p.author}</span>
        {p.location && <span>📍{p.location}</span>}
        {p.reward && p.reward !== '—' && <span className="preward">💰{p.reward}</span>}
      </div>
      {p.expected_time && <div className="ptime">⏰ {p.expected_time}</div>}
    </div>
  );
}

export default function Plaza() {
  const { setDetailId, user } = useApp();
  const [cat, setCat] = useState('全部');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [posts, setPosts] = useState([]);
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (cat !== '全部') params.category = cat;
      if (status !== 'all') params.status = status;
      if (q.trim()) params.q = q.trim();
      const data = await api.getPosts(params);
      setPosts(data);
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }, [cat, status, q]);

  useEffect(() => { load(); }, [load]);

  // 默认视图（全部+无筛选）展示智能推荐
  useEffect(() => {
    if (cat === '全部' && status === 'all' && !q.trim()) {
      api.recommend().then(setRecs).catch(() => {});
    } else setRecs([]);
  }, [cat, status, q]);

  return (
    <div className="page">
      <header className="page-head">
        <h2>互助广场</h2>
        <p className="page-sub">🤖 基于你的发帖偏好，已为你智能推荐</p>
      </header>

      <div className="searchbar">
        <input placeholder="🔍 搜索互助需求，如：代拿外卖、组队" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      <div className="chips">
        {CATS.map(c => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
        <select value={status} onChange={e => setStatus(e.target.value)} className="status-sel">
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {recs.length > 0 && (
        <section className="rec-section">
          <div className="rec-title">✨ 为你推荐</div>
          <div className="rec-grid">
            {recs.slice(0, 4).map(p => <PostCard key={'r' + p.id} p={p} onClick={() => setDetailId(p.id)} />)}
          </div>
        </section>
      )}

      <section className="feed">
        {loading && <div className="muted">加载中…</div>}
        {!loading && posts.length === 0 && <div className="empty">暂无相关帖子，去「发帖」发布第一个需求吧～</div>}
        {posts.map(p => <PostCard key={p.id} p={p} onClick={() => setDetailId(p.id)} />)}
      </section>
    </div>
  );
}
