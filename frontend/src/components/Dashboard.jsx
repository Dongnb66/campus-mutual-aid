import React, { useState, useEffect } from 'react';
import { api } from '../api.js';

const CAT_COLOR = {
  代拿: '#ff7a45', 接课: '#ff4d4f', 寻物: '#f59e0b',
  二手: '#16a34a', 组队: '#3b82f6', 其他: '#8a93a3',
};
const STATUS_COLOR = { open: '#3b82f6', accepted: '#f59e0b', completed: '#16a34a', cancelled: '#cbd5e1' };
const STATUS_LABEL = { open: '待接单', accepted: '进行中', completed: '已完成', cancelled: '已取消' };

function StatCard({ icon, label, value, accent }) {
  return (
    <div className="stat-card" style={{ '--ac': accent }}>
      <span className="stat-ico">{icon}</span>
      <div>
        <div className="stat-num">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function Donut({ segments }) {
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <svg width="150" height="150" viewBox="0 0 150 150">
      <circle cx="75" cy="75" r={R} fill="none" stroke="#eee" strokeWidth="16" />
      {segments.map((s, i) => {
        const frac = s.value / segments.reduce((a, b) => a + b.value, 0) || 0;
        const dash = frac * C;
        const off = -acc * C;
        acc += frac;
        return (
          <circle key={i} cx="75" cy="75" r={R} fill="none"
            stroke={s.color} strokeWidth="16" strokeLinecap="butt"
            strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={off}
            transform="rotate(-90 75 75)" />
        );
      })}
      <text x="75" y="71" textAnchor="middle" fontSize="22" fontWeight="800" fill="#1f2430">
        {segments.reduce((a, b) => a + b.value, 0)}
      </text>
      <text x="75" y="90" textAnchor="middle" fontSize="11" fill="#8a93a3">互助帖</text>
    </svg>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [helpers, setHelpers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.stats(), api.topHelpers()])
      .then(([s, h]) => { setStats(s); setHelpers(h.list || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">加载平台数据中…</div>;
  if (!stats) return <div className="empty">统计暂不可用</div>;

  const maxCat = Math.max(1, ...stats.byCategory.map(c => c.c));
  const totalPosts = stats.posts || 1;
  const statusSegs = (stats.byStatus || []).map(s => ({
    label: STATUS_LABEL[s.status] || s.status, value: s.c, color: STATUS_COLOR[s.status] || '#8a93a3',
  }));

  return (
    <div className="page">
      <div className="page-head">
        <h2>📊 平台数据</h2>
        <div className="page-sub">校园互助生态实时概览 · 数据驱动运营决策</div>
      </div>

      <div className="dash-grid">
        <StatCard icon="👥" label="注册用户" value={stats.users} accent="#ff7a45" />
        <StatCard icon="📋" label="互助帖总数" value={stats.posts} accent="#ff4d4f" />
        <StatCard icon="⏳" label="进行中" value={stats.accepted} accent="#f59e0b" />
        <StatCard icon="✅" label="已完成互助" value={stats.completed} accent="#16a34a" />
        <StatCard icon="💬" label="累计评论" value={stats.comments} accent="#3b82f6" />
        <StatCard icon="🔁" label="私信往来" value={stats.dms} accent="#8b5cf6" />
      </div>

      <div className="dash-row">
        <div className="panel">
          <div className="panel-title">互助分类分布</div>
          <div className="bars">
            {stats.byCategory.length === 0 && <div className="muted small">暂无数据</div>}
            {stats.byCategory.map(c => (
              <div className="bar-row" key={c.category}>
                <span className="bar-label">{c.category}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(c.c / maxCat) * 100}%`, background: CAT_COLOR[c.category] || '#8a93a3' }} />
                </div>
                <span className="bar-val">{c.c}<i> · {Math.round((c.c / totalPosts) * 100)}%</i></span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">完成态势</div>
          <div className="donut-wrap">
            <Donut segments={statusSegs} />
            <div className="legend">
              {statusSegs.map((s, i) => (
                <div className="legend-row" key={i}>
                  <span className="legend-dot" style={{ background: s.color }} />
                  <span className="legend-name">{s.label}</span>
                  <span className="legend-val">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel-foot">累计浏览 <b>{stats.views}</b> 次 · 通知 <b>{stats.notifs}</b> 条</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">🏆 互助达人榜</div>
        <div className="rank-list">
          {helpers.length === 0 && <div className="muted small">还没有人完成互助，快去接第一单吧！</div>}
          {helpers.map((u, i) => (
            <div className="rank-row" key={u.id}>
              <span className={`rank-no r${i + 1}`}>{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
              <span className="avatar sm">{u.avatar}</span>
              <span className="rank-name">{u.nickname}</span>
              <span className="rank-credit">信用 {u.credit_score}</span>
              <span className="rank-done">已完成 <b>{u.completed_count}</b></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
