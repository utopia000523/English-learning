// 表达卡复习（PRD 3.3）。界面参考 docs/prototype.html「表达卡」
// 快捷键：空格 翻面；翻面后 1 没想起 / 2 想起但卡 / 3 脱口而出
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { speak } from '../services/tts.js';
import { Icon } from '../icons.jsx';

const dayLabel = (n) => (n <= 1 ? '明天' : `约 ${n} 天后`);

export default function Cards() {
  const [data, setData] = useState(null);
  const [queue, setQueue] = useState([]);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState({});
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const d = await api.get('/cards/today');
      setData(d); setQueue(d.cards); setTotal(d.cards.length); setDone(0); setFlipped(false);
    } catch { setErr('无法连接本地服务：请在终端重新运行 bash scripts/start.sh，并保持窗口开着。'); }
  };
  useEffect(() => { load(); api.get('/settings').then((s) => setVoice({ voice: s.ttsVoice, rate: s.ttsRate })).catch(() => {}); }, []);

  const card = queue[0];
  // 单击翻面；双击或拖动选词（划词查询）时不翻面
  const clickTimer = useRef(null);
  const onCardClick = (e) => {
    if (e.detail > 1) { clearTimeout(clickTimer.current); return; }
    clickTimer.current = setTimeout(() => {
      if (!window.getSelection()?.toString().trim()) setFlipped((f) => !f);
    }, 250);
  };

  const rate = useCallback(async (rating) => {
    if (!card || !flipped || busy) return;
    setBusy(true);
    try {
      await api.post(`/cards/${card.id}/review`, { rating });
      const rest = queue.slice(1);
      // 没想起：本轮末尾再出现一次
      setQueue(rating === 1 ? [...rest, { ...card, isNew: false, again: true }] : rest);
      if (rating !== 1) setDone((n) => n + 1);
      setFlipped(false);
      if (!rest.length && rating !== 1) api.get('/cards/today').then((d) => setData((o) => ({ ...o, stats: d.stats, reviewedToday: d.reviewedToday })));
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }, [card, flipped, busy, queue]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); setFlipped((f) => !f); }
      if (['1', '2', '3'].includes(e.key)) rate(Number(e.key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rate]);

  const head = (
    <div className="head">
      <div><h1>表达卡复习</h1><p className="sub">先看中文自己说，再翻面对照。</p></div>
      {data && card && <span className="faint">今日 {total} 张 · 剩 {queue.length} 张</span>}
    </div>
  );

  if (err) return <div className="narrow">{head}<div className="todo-note">{err}</div></div>;
  if (!data) return <div className="narrow">{head}</div>;
  const s = data.stats;

  if (!card) {
    return (
      <div className="narrow">
        {head}
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <h2>{total ? '今天的表达卡复习完成了' : '今天没有需要复习的卡片'}</h2>
          <p className="sub">今天共复习 {data.reviewedToday} 张 · 第 {data.dayNo} 天 / 90</p>
          <div style={{ marginTop: 22 }}><Link className="btn line" to="/today">返回今日</Link></div>
        </div>
        <p className="faint" style={{ textAlign: 'center' }}>熟练 {s.mastered} · 学习中 {s.learning} · 未学新卡 {s.newLeft}</p>
      </div>
    );
  }

  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="narrow">
      {head}
      <div className="bar a" style={{ maxWidth: 600, margin: '0 auto 26px' }}><i style={{ width: pct + '%' }} /></div>
      <div className="fc-wrap">
        <div className={`fc ${flipped ? 'flipped' : ''}`} onClick={onCardClick}>
          <div className="face">
            <span className="faint">第 {card.week} 周 · {card.scene || card.source}{card.isNew ? ' · 新卡' : ''}{card.again ? ' · 再来一次' : ''}</span>
            <div className="big">{card.zh || card.en}</div>
            <div className="faint">先用英语说出来，再点卡片或按空格翻面</div>
          </div>
          <div className="face back">
            <div className="big">{card.en}</div>
            {card.example && (
              <div className="muted row" style={{ gap: 2, justifyContent: 'center' }}>
                也可以：{card.example}
                <button className="link" title="朗读" onClick={(e) => { e.stopPropagation(); speak(card.example, voice); }}>{Icon.speaker}</button>
              </div>
            )}
            <div className="row" style={{ marginTop: 14, gap: 4 }}>
              <button className="link" onClick={(e) => { e.stopPropagation(); speak(card.en, voice); }}>{Icon.speaker}朗读</button>
            </div>
          </div>
        </div>
        <div className="rate" style={{ opacity: flipped ? 1 : 0.45 }}>
          <button disabled={!flipped || busy} onClick={() => rate(1)}>没想起<small>1 · 本轮再出现，{dayLabel(1)}复习</small></button>
          <button disabled={!flipped || busy} onClick={() => rate(2)}>想起但卡<small>2 · {dayLabel(card.preview[2])}</small></button>
          <button disabled={!flipped || busy} onClick={() => rate(3)}>脱口而出<small>3 · {dayLabel(card.preview[3])}</small></button>
        </div>
        <p className="faint" style={{ textAlign: 'center', marginTop: 26 }}>熟练 {s.mastered} · 学习中 {s.learning} · 未学新卡 {s.newLeft}</p>
      </div>
    </div>
  );
}
