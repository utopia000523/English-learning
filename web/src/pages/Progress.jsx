// 进度（PRD 1.1、3.8）。界面参考 docs/prototype.html「进度」
import { useEffect, useState } from 'react';
import { api } from '../services/api.js';

function Trend({ data }) {
  if (data.length < 2) return <p className="faint" style={{ padding: '40px 0' }}>完成 2 次以上话题独白后，这里会显示语速变化。</p>;
  const pts = data.slice(-20);
  const max = Math.max(110, ...pts.map((d) => d.wpm)); const min = Math.min(40, ...pts.map((d) => d.wpm));
  const x = (i) => 34 + i * (560 / Math.max(1, pts.length - 1));
  const y = (v) => 170 - ((v - min) / (max - min)) * 150;
  return (
    <svg className="chart" viewBox="0 0 620 190">
      {[60, 80, 100].filter((v) => v > min && v < max).map((v) => <g key={v}><line x1="34" x2="600" y1={y(v)} y2={y(v)} stroke="#e6e3d9" /><text x="4" y={y(v) + 4} fontSize="11" fill="#a3a19a">{v}</text></g>)}
      <line x1="34" x2="600" y1={y(100)} y2={y(100)} stroke="#c6613f" strokeDasharray="4 4" />
      <path d={pts.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.wpm)}`).join(' ')} fill="none" stroke="#1f1e1d" strokeWidth="1.8" />
      {pts.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.wpm)} r="3" fill="#faf9f5" stroke="#1f1e1d" strokeWidth="1.5"><title>{d.date} · {d.wpm} 词/分</title></circle>)}
    </svg>
  );
}

export default function Progress() {
  const [p, setP] = useState(null);
  useEffect(() => { api.get('/progress').then(setP).catch(() => {}); }, []);
  if (!p) return null;
  const pct = (v, t) => Math.min(100, Math.round(((v || 0) / t) * 100));
  const kpis = [
    [p.wpm ?? '—', '独白语速 词/分', '目标 ≥ 100', pct(p.wpm, 100)],
    [p.longPauses ?? '—', '1 分钟长停顿', '目标 ≤ 2', p.longPauses == null ? 0 : p.longPauses <= 2 ? 100 : pct(2, p.longPauses)],
    [`${p.scenesPassed} / ${p.scenesTotal}`, '场景通关', '目标：全部通关', pct(p.scenesPassed, p.scenesTotal || 1)],
    [p.mastered, '熟练表达', '目标 ≥ 300', pct(p.mastered, 300)],
  ];
  return (
    <>
      <div className="head"><div><h1>进度</h1><p className="sub">对照 90 天目标看变化。语速和停顿取最近 3 次独白的平均值。</p></div></div>
      <div className="kpis">
        {kpis.map((k) => <div key={k[1]}><b>{k[0]}</b><span>{k[1]}</span><div className="bar a"><i style={{ width: `${k[3]}%` }} /></div><span className="faint">{k[2]}</span></div>)}
      </div>
      <p className="faint" style={{ marginTop: 10 }}>第 {p.dayNo} 天 · 累计开口 {p.speakMin} 分钟（目标 900） · 连续打卡 {p.streak} 天 · 学习中表达 {p.learning} 条 · 笔记 {p.notes} 条</p>
      <div className="two sec">
        <div><div className="sec-t"><span>独白语速趋势（词/分）</span><span className="faint">虚线为目标 100</span></div><Trend data={p.trend} /></div>
        <div>
          <div className="sec-t">测评记录</div>
          <table>
            <thead><tr><th>测评</th><th>语速</th><th>长停顿</th><th>口头禅</th></tr></thead>
            <tbody>{['入门 · 第 0 天', '第 30 天', '第 60 天', '第 90 天'].map((t) => <tr key={t}><td className="faint">{t}</td><td colSpan="3" className="faint">{t.startsWith('入门') ? '入门测评即将上线' : ''}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      <div className="sec">
        <div className="sec-t">徽章</div>
        <div className="badges">{p.badges.map((b) => <span key={b.name} className={`badge ${b.got ? '' : 'lock'}`}>{b.name}</span>)}</div>
      </div>
    </>
  );
}
