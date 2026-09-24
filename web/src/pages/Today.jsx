// 今日（PRD 2.3、3.1）：热身 → 两个随机练习 → 收尾。界面参考 docs/prototype.html「今日」
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api.js';
import { speak } from '../services/tts.js';
import { Icon } from '../icons.jsx';

const NAME = { cards: '表达卡复习', shadow: '跟读', roleplay: 'AI 情景对话', mono: '话题独白', review: '今日收尾' };
const PHASE = ['', '敢开口', '能对话', '说得久'];
const ST = { done: <span className="st ok">已完成</span>, doing: <span className="st go">进行中</span>, todo: <span className="st">未开始</span> };

function Wrap({ onClose, onDone }) {
  const [items, setItems] = useState(null);
  const [added, setAdded] = useState({});
  useEffect(() => { api.get('/plan/wrap').then(setItems); }, []);
  const add = async (it, i) => { await api.post('/cards', { en: it.en, zh: it.zh, source: it.from, scene: '今日收尾' }); setAdded((a) => ({ ...a, [i]: true })); };
  return (
    <div className="mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>今日收尾</h2>
        <p className="sub">把今天说错或值得学的句子再大声说一遍，想长期记住的加入表达卡。</p>
        {items && items.length === 0 && <p className="muted" style={{ marginTop: 18 }}>今天还没有需要回顾的句子。可以直接完成收尾。</p>}
        {items && items.length > 0 && (
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 18 }}>
            {items.map((it, i) => (
              <div className="fix" key={i}>
                <div>
                  {it.you && <div className="o">{it.you}</div>}
                  <div className="n">{it.en}</div>
                  <div className="faint">{it.from}{it.note ? ` · ${it.note}` : ''}{it.zh ? ` · ${it.zh}` : ''}</div>
                </div>
                <div className="row" style={{ gap: 2 }}>
                  <button className="link" onClick={() => speak(it.en)}>{Icon.speaker}</button>
                  <button className="link" disabled={added[i]} onClick={() => add(it, i)}>{added[i] ? '已加入' : '+ 表达卡'}</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 22 }}>
          <button className="btn line" onClick={onClose}>稍后</button>
          <button className="btn accent" onClick={onDone}>完成收尾</button>
        </div>
      </div>
    </div>
  );
}

export default function Today() {
  const [p, setP] = useState(null);
  const [err, setErr] = useState('');
  const [wrap, setWrap] = useState(false);
  const nav = useNavigate();
  const load = () => api.get('/plan/today').then(setP).catch(() => setErr('无法连接本地服务：请在终端重新运行 bash scripts/start.sh，并保持窗口开着。'));
  useEffect(() => { load(); }, []);

  const go = async (s) => {
    if (s.module === 'review') return setWrap(true);
    if (s.module === 'roleplay' && s.sceneId) {
      const rp = await api.post('/roleplay', { sceneId: s.sceneId });
      return nav(`/roleplay/${rp.id}`);
    }
    if (s.module === 'shadow' && s.shadowId) return nav(`/shadow?m=${s.shadowId}`);
    if (s.module === 'mono' && s.topicId) return nav(`/mono?t=${s.topicId}`);
    return nav(`/${s.module}`);
  };
  const swap = async () => { try { setP(await api.post('/plan/swap')); } catch (e) { setErr(e.message); } };

  const h = new Date().getHours();
  const hello = h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好';
  if (!p) return <div className="narrow"><h1>{hello}，Utopia</h1>{err && <div className="todo-note" style={{ marginTop: 20 }}>{err}</div>}</div>;
  const next = p.slots.find((s) => s.status !== 'done');
  const canSwap = !p.swapped && p.slots.some((s) => s.label === '随机' && s.status === 'todo');

  return (
    <div className="narrow">
      <h1>{hello}，Utopia</h1>
      <p className="sub">第 {p.week} 周第 {p.dayInWeek} 天 · {p.theme}　｜　第 {p.phase} 阶段「{PHASE[p.phase]}」</p>
      {p.assessmentDue != null && (
        <div className="todo-note row between" style={{ marginTop: 18 }}>
          <span>{p.assessmentDue === 0 ? '先做一次入门测评（约 8 分钟），记录你现在的口语基线，之后才能看到进步。' : `到第 ${p.assessmentDue} 天了，做一次复测（约 8 分钟），和入门时对比。`}</span>
          <Link className="btn accent sm" to="/assessment">开始测评</Link>
        </div>
      )}
      <div className="today-meta">
        <span>第 <b>{p.dayNo}</b> 天 / 90</span>
        <div className="bar a"><i style={{ width: `${Math.round(p.ratio * 100)}%` }} /></div>
        <span className="faint">今日 {p.done} / {p.total} 分钟{p.streak ? ` · 连续打卡 ${p.streak} 天` : ''}</span>
      </div>
      <div className="sec">
        <div className="sec-t">
          <span>今日练习{p.dayInWeek === 7 ? ' · 第 7 天复习日' : p.slots.some((s) => s.slot === 'scene') ? ' · 今日场景 + 跟读或独白（轮流）' : ' · 中间两项按阶段权重随机抽取'}</span>
          {p.slots.some((s) => s.label === '随机') && <button className="link" onClick={swap} disabled={!canSwap} style={canSwap ? {} : { opacity: 0.5 }}>{Icon.shuffle}{p.swapped ? '今日已换过' : '换一个'}</button>}
        </div>
        <div className="list">
          {p.slots.map((s, i) => (
            <div className="li" key={s.slot} style={{ cursor: 'pointer' }} onClick={() => go(s)}>
              <span className="num">{i + 1}</span>
              <div className="t"><b>{NAME[s.module]}</b>{s.detail && <span className="faint"> · {s.detail}</span>}</div>
              <span className="faint" style={{ width: 110, whiteSpace: 'nowrap' }}>{s.label} {s.minutes} 分钟</span>
              <span style={{ width: 70 }}>{ST[s.status]}</span>
            </div>
          ))}
        </div>
        {err && <p style={{ color: 'var(--bad)', fontSize: 13, marginTop: 10 }}>{err}</p>}
      </div>
      <div style={{ marginTop: 28 }}>
        {next ? <button className="btn accent" onClick={() => go(next)}>{Icon.play}{p.done ? '继续今日练习' : '开始今日练习'}</button>
          : <p className="muted">今天的练习全部完成了，明天见。</p>}
      </div>
      {wrap && <Wrap onClose={() => setWrap(false)} onDone={async () => { setP(await api.post('/plan/wrap')); setWrap(false); }} />}
    </div>
  );
}
