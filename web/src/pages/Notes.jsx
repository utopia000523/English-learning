// 笔记本（PRD 3.7）：划词、手动收藏的词和短语。Notion 同步在阶段 5
import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { speak } from '../services/tts.js';
import { Icon } from '../icons.jsx';

const SOURCES = ['表达卡', 'AI 对话', '跟读', '独白', '手动', '其他'];

export default function Notes() {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [open, setOpen] = useState({});
  const [carded, setCarded] = useState({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ en: '', zh: '' });
  const [err, setErr] = useState('');

  const load = () => api.get(`/notes?q=${encodeURIComponent(q)}&source=${encodeURIComponent(source)}`).then(setList)
    .catch(() => setErr('无法连接本地服务：请在终端重新运行 bash scripts/start.sh，并保持窗口开着。'));
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q, source]); // eslint-disable-line react-hooks/exhaustive-deps

  const del = async (n) => { if (!window.confirm(`删除「${n.en}」？`)) return; await api.del(`/notes/${n.id}`); load(); };
  const toCard = async (n) => {
    await api.post('/cards', { en: n.en, zh: n.zh, example: n.detail?.example || '', source: '笔记本', scene: n.source });
    setCarded((c) => ({ ...c, [n.id]: true }));
  };
  const add = async () => {
    if (!form.en.trim()) return;
    await api.post('/notes', { ...form, source: '手动' });
    setForm({ en: '', zh: '' }); setAdding(false); load();
  };

  return (
    <>
      <div className="head">
        <div><h1>笔记本</h1><p className="sub">在任何页面选中不认识的英文词或短语，点「查词」即可查询并加入这里。</p></div>
        <button className="btn line sm" onClick={() => setAdding((a) => !a)}>{Icon.plus}手动添加</button>
      </div>
      {adding && (
        <div className="row" style={{ marginBottom: 16 }}>
          <input className="in" placeholder="英文词或短语" value={form.en} onChange={(e) => setForm({ ...form, en: e.target.value })} style={{ width: 240 }} />
          <input className="in" placeholder="中文意思（可选）" value={form.zh} onChange={(e) => setForm({ ...form, zh: e.target.value })} style={{ width: 200 }} />
          <button className="btn sm" onClick={add}>保存</button>
        </div>
      )}
      <div className="filters">
        <input className="in" placeholder="搜索英文、中文或原句" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
        <select className="in" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">全部来源</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {list && <span className="faint" style={{ marginLeft: 'auto' }}>共 {list.length} 条</span>}
      </div>
      {err && <div className="todo-note">{err}</div>}
      {list && list.length === 0 && <div className="todo-note">还没有笔记。去表达卡或 AI 对话里，选中不认识的词试试。</div>}
      {list && list.length > 0 && (
        <table>
          <thead><tr><th>英文</th><th>中文</th><th>来源</th><th>日期</th><th></th></tr></thead>
          <tbody>
            {list.map((n) => (
              <tr key={n.id}>
                <td>
                  <span style={{ fontFamily: 'var(--serif)', fontSize: 15, cursor: 'pointer' }} onClick={() => setOpen((o) => ({ ...o, [n.id]: !o[n.id] }))}>{n.en}</span>
                  {n.ipa && <span className="faint" style={{ marginLeft: 8 }}>{n.ipa}</span>}
                  {n.detail?.pos && <span className="faint" style={{ marginLeft: 8, fontStyle: 'italic' }}>{n.detail.pos}</span>}
                  {n.context && <div className="faint" style={{ marginTop: 2 }}>{n.context.length > 90 ? n.context.slice(0, 90) + '…' : n.context}</div>}
                  {open[n.id] && n.detail && (
                    <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                      {n.detail.usage_zh}
                      {n.detail.example && <div style={{ marginTop: 2 }}><span style={{ fontFamily: 'var(--serif)' }}>{n.detail.example}</span> {n.detail.example_zh}</div>}
                    </div>
                  )}
                </td>
                <td className="muted">{n.zh}</td>
                <td className="muted">{n.source}</td>
                <td className="faint">{n.createdAt?.slice(5, 10)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="link" title="朗读" onClick={() => speak(n.en)}>{Icon.speaker}</button>
                  <button className="link" disabled={carded[n.id]} onClick={() => toCard(n)}>{carded[n.id] ? '已加入' : '+ 表达卡'}</button>
                  <button className="link" onClick={() => del(n)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
