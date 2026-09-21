// 全局划词：在任意英文内容中选中词或短语 → 「查词」→ 本地 AI 结合语境解释 → 加入笔记本 / 表达卡
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../services/api.js';
import { speak } from '../services/tts.js';
import { Icon } from '../icons.jsx';

const SOURCE = { '/cards': '表达卡', '/roleplay': 'AI 对话', '/shadow': '跟读', '/mono': '独白' };
const validPick = (t) => t && t.length <= 60 && /[a-zA-Z]/.test(t) && !/[一-鿿]/.test(t) && t.split(/\s+/).length <= 6;

function contextOf(sel) {
  let el = sel.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
  while (el && el !== document.body && (el.innerText || '').trim().length < 20) el = el.parentElement;
  return (el?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export default function SelectionLookup() {
  const loc = useLocation();
  const [pick, setPick] = useState(null);  // { text, context, x, y }
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [ipa, setIpa] = useState('');
  const [saved, setSaved] = useState({});
  const box = useRef(null);
  const pending = useRef(null); // 预取中的查词请求
  const source = Object.entries(SOURCE).find(([p]) => loc.pathname.startsWith(p))?.[1] || '其他';

  useEffect(() => {
    const onUp = (e) => {
      if (box.current?.contains(e.target)) return;
      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().replace(/\s+/g, ' ').trim().replace(/^[^a-zA-Z']+|[^a-zA-Z']+$/g, '');
        const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
        if (!sel || sel.isCollapsed || inInput || !validPick(text)) { if (!open) setPick(null); return; }
        const r = sel.getRangeAt(0).getBoundingClientRect();
        setPick({ text, context: contextOf(sel), x: r.left + r.width / 2, y: r.bottom });
        setOpen(false); setInfo(null); setErr(''); setSaved({}); setIpa(''); pending.current = null;
      }, 0);
    };
    const onDown = (e) => { if (!box.current?.contains(e.target)) { setOpen(false); } };
    const onKey = (e) => { if (e.key === 'Escape') { setPick(null); setOpen(false); } };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mouseup', onUp); document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => { setPick(null); setOpen(false); }, [loc.pathname]);

  // 预取：鼠标移到「查词」上就先发请求，点开时通常已经好了
  const fetchInfo = () => {
    if (!pick) return null;
    if (!pending.current) {
      pending.current = api.post('/lookup', { text: pick.text, context: pick.context });
      api.get(`/ipa?text=${encodeURIComponent(pick.text)}`).then((r) => setIpa(r.ipa)).catch(() => {});
    }
    return pending.current;
  };
  const doLookup = async () => {
    setOpen(true); setErr('');
    try { setInfo(await fetchInfo()); }
    catch (e) { setErr(e.message); }
  };
  const save = async (kind) => {
    try {
      if (kind === 'note') {
        const r = await api.post('/notes', { en: pick.text, zh: info?.zh || '', source, context: pick.context, detail: info || {} });
        setSaved((s) => ({ ...s, note: r.duplicate ? '笔记本里已有' : '已加入笔记本' }));
      } else {
        await api.post('/cards', { en: pick.text, zh: info?.zh || '', example: info?.example || '', source: '划词', scene: source });
        setSaved((s) => ({ ...s, card: '已加入表达卡' }));
      }
    } catch (e) { setErr(e.message); }
  };

  if (!pick) return null;
  const left = Math.min(Math.max(12, pick.x - 150), window.innerWidth - 312);
  const top = Math.min(pick.y + 8, window.innerHeight - (open ? 280 : 50));
  return (
    <div ref={box} className="lookup" style={{ left, top }} onMouseDown={(e) => e.preventDefault()}>
      {!open ? (
        <button className="lookup-pill" onMouseEnter={fetchInfo} onClick={doLookup}>查词 · {pick.text.length > 24 ? pick.text.slice(0, 24) + '…' : pick.text}</button>
      ) : (
        <div className="lookup-card">
          <div className="row between">
            <b style={{ fontFamily: 'var(--serif)', fontSize: 17 }}>{pick.text}</b>
            <button className="link" onClick={() => speak(pick.text)}>{Icon.speaker}</button>
          </div>
          {(info?.ipa || ipa) && <div className="faint">{info?.ipa || ipa}</div>}
          {!info && !err && <p className="faint" style={{ marginTop: 6 }}>查询中…</p>}
          {err && <p style={{ color: 'var(--bad)', fontSize: 13, marginTop: 6 }}>{err}</p>}
          {info && <>
            <p style={{ marginTop: 4 }}>{info.pos && <span className="faint">{info.pos} </span>}{info.zh}</p>
            {info.usage_zh && <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>{info.usage_zh}</p>}
            {info.example && <p style={{ fontSize: 13, marginTop: 6 }}><span style={{ fontFamily: 'var(--serif)' }}>{info.example}</span> <span className="faint">{info.example_zh}</span></p>}
          </>}
          <div className="row" style={{ gap: 4, marginTop: 10, marginLeft: -6 }}>
            <button className="link" disabled={!!saved.note} onClick={() => save('note')}>{saved.note || '+ 加入笔记本'}</button>
            <button className="link" disabled={!!saved.card} onClick={() => save('card')}>{saved.card || '+ 加入表达卡'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
