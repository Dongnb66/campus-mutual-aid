import React, { useState } from 'react';
import { useApp } from '../ctx.js';
import { api } from '../api.js';

const EXAMPLES = ['明天谁帮我拿外卖', '有没有人明天帮我带饭', '寻物：捡到校园卡', '组队参加比赛'];

export default function Search() {
  const { setDetailId } = useApp();
  const [q, setQ] = useState('');
  const [reply, setReply] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  async function doSearch(text) {
    if (!text.trim()) return;
    setBusy(true); setReply(''); setResults([]);
    try {
      const r = await api.chat(text);
      setReply(r.reply || '');
      if (r.results) setResults(r.results);
    } catch (e) { setReply('出错了：' + e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="page">
      <header className="page-head"><h2>智能检索</h2>
        <p className="page-sub">🤖 用自然语言描述，AI 帮你找到匹配的互助帖</p></header>

      <div className="searchbar big">
        <input placeholder="例如：明天谁帮我拿外卖" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch(q)} />
        <button onClick={() => doSearch(q)} disabled={busy}>{busy ? '搜索中…' : '语义搜索'}</button>
      </div>

      <div className="examples">
        {EXAMPLES.map(x => <button key={x} className="ex-chip" onClick={() => { setQ(x); doSearch(x); }}>{x}</button>)}
      </div>

      {reply && <div className="search-reply">{reply}</div>}
      <div className="feed">
        {results.map(p => (
          <div className="pcard" key={p.id} onClick={() => setDetailId(p.id)}>
            <div className="pcard-top"><span className="pcat">{p.category}</span></div>
            <h3>{p.title}</h3><p className="pcontent">{p.content}</p>
            <div className="pmeta">
              <span>{p.author_avatar} {p.author}</span>
              {p.location && <span>📍{p.location}</span>}
              {p.reward && p.reward !== '—' && <span className="preward">💰{p.reward}</span>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
