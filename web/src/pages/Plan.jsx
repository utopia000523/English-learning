// 学习计划（PRD 2.1、2.2、3.6）。界面参考 docs/prototype.html「学习计划」
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api.js';

const NAME = { cards: '表达卡', shadow: '跟读', roleplay: 'AI 对话', mono: '独白' };
const level = (r) => (r >= 1 ? 'l3' : r >= 0.5 ? 'l2' : r > 0 ? 'l1' : '');

export default function Plan() {
  const [p, setP] = useState(null);
  useEffect(() => { api.get('/plan').then(setP).catch(() => {}); }, []);
  if (!p) return null;
  const cur = p.phases[p.phase - 1];
  return (
    <>
      <div className="head">
        <div><h1>学习计划</h1><p className="sub">从 {p.startDate} 开始 · 每周 6 天练习 · 周日轻复习</p></div>
        <Link className="btn line sm" to="/settings">调整每日设置</Link>
      </div>
      <div className="phases">
        {p.phases.map((ph) => (
          <div key={ph.no} className={ph.no === p.phase ? 'cur' : ''}>
            <b>第 {ph.no} 阶段 · {ph.name}</b>
            <div className="faint">第 {ph.weeks} 周 · {ph.focus}</div>
            <div className={`bar ${ph.no === p.phase ? 'a' : ''}`} style={{ marginTop: 10 }}><i style={{ width: `${Math.round(ph.progress * 100)}%` }} /></div>
          </div>
        ))}
      </div>
      <hr />
      <div className="two">
        <div>
          <div className="sec-t"><span>90 天日历</span><span className="faint">颜色越深完成度越高</span></div>
          <div className="cal">
            {p.days.map((d) => <div key={d.dayNo} className={`${level(d.ratio)} ${d.dayNo === p.dayNo ? 'today' : ''}`} title={`第 ${d.dayNo} 天 · ${d.date} · 完成 ${Math.round(d.ratio * 100)}%`}>{d.dayNo}</div>)}
          </div>
        </div>
        <div>
          <div className="sec-t">本阶段练习比例（随机抽取权重）</div>
          {Object.entries(cur.weights).map(([k, w]) => (
            <div key={k} style={{ marginBottom: 12 }}>
              <div className="row between" style={{ fontSize: 13.5 }}><span>{NAME[k]}</span><span className="faint">{w}%</span></div>
              <div className="bar" style={{ marginTop: 4 }}><i style={{ width: `${w * 2}%` }} /></div>
            </div>
          ))}
          <p className="faint">表达卡固定作为每天的热身；中间两项从跟读、AI 对话、独白里按比例抽取，连续 2 天没出现的练习下次抽中概率翻倍。每周第 6 天是本周 AI 对话通关挑战。</p>
          <p className="faint" style={{ marginTop: 6 }}>测评：第 30 天 · 第 60 天 · 第 90 天</p>
        </div>
      </div>
      <div className="sec">
        <div className="sec-t">12 周路线</div>
        <div className="weeks">
          {p.weeks.map((w) => (
            <div className="li" key={w.week} style={{ padding: '11px 2px' }}>
              <span className="faint" style={{ width: 48 }}>第 {w.week} 周</span>
              <div className="t" style={w.week === p.week ? { fontWeight: 600 } : {}}>{w.theme}</div>
              {w.week < p.week ? <span className="st ok">已过</span> : w.week === p.week ? <span className="st go">本周</span> : !w.hasContent ? <span className="faint">内容待补</span> : null}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
