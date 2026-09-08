import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { useApp } from '../ctx.js';

export default function Assistant() {
  const { setDetailId } = useApp();
  const [log, setLog] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const endRef = useRef(null);

  useEffect(() => {
    api.chatHistory().then(h => {
      if (h && h.length) setLog(h.map(m => ({ me: m.role === 'user', text: m.content })));
      else setLog([{ me: false, text: '你好～我是校园互助助手 🤖\n我可以帮你：\n① 一句话发帖（如「帮忙代拿外卖到3栋，报酬5元」）\n② 找帖（如「有没有人明天帮我带饭」）\n③ 解答平台使用问题。' }]);
    }).catch(() => {});
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [log]);

  async function send() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput(''); setBusy(true);
    setLog(l => [...l, { me: true, text }]);
    try {
      const r = await api.chat(text);
      let reply = r.reply || '';
      if (r.intent === 'search' && Array.isArray(r.results)) {
        setResults(r.results);
        reply += `\n（共找到 ${r.results.length} 条相关帖子，点击下方卡片可查看详情）`;
      } else {
        setResults([]);
      }
      setLog(l => [...l, { me: false, text: reply }]);
    } catch (e) { setLog(l => [...l, { me: false, text: '出错了：' + e.message }]); }
    finally { setBusy(false); }
  }

  return (
    <div className="page chat-page">
      <header className="page-head"><h2>互助助手</h2>
        <p className="page-sub">🤖 Router 智能体 · 自动识别发帖 / 检索 / 咨询意图</p></header>
      <div className="chat-box">
        {log.map((m, i) => (
          <div key={i} className={m.me ? 'bubble me' : 'bubble bot'}>
            <pre>{m.text}</pre>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="chat-input">
        <input placeholder="和助手说话…" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()} />
        <button onClick={send} disabled={busy}>{busy ? '…' : '发送'}</button>
      </div>
      {results.length > 0 && (
        <div className="feed" style={{ marginTop: 12 }}>
          {results.map(p => (
            <div className="pcard" key={p.id} onClick={() => setDetailId(p.id)}>
              <div className="pcard-top">
                <span className="pcat">{p.category}</span>
                <span className="pstatus" style={{ color: '#8a93a3' }}>
                  {p.author_avatar} {p.author}
                </span>
              </div>
              <h3>{p.title}</h3>
              <p className="pcontent">{p.content}</p>
              <div className="pmeta">
                {p.location && <span>📍{p.location}</span>}
                {p.reward && p.reward !== '—' && <span className="preward">💰{p.reward}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
