// 测评（PRD 2.4）：跟读 3 句 → 1 分钟自我介绍 → 回答 3 个问题。约 8 分钟
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { speak } from '../services/tts.js';
import { transcribe } from '../services/recorder.js';
import { useMic } from '../services/useMic.js';
import { Icon } from '../icons.jsx';

const NAME = (m) => (m === 0 ? '入门测评' : `第 ${m} 天测评`);

export default function Assessment() {
  const [info, setInfo] = useState(null);
  const [step, setStep] = useState('intro'); // intro → shadow → mono → qa → done
  const [i, setI] = useState(0);
  const [ids, setIds] = useState({ shadow: [], mono: null, answers: [] });
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [voice, setVoice] = useState({});
  const mic = useMic({ maxSeconds: 60, onAutoStop: () => stop() });

  useEffect(() => {
    api.get('/assessment').then(setInfo).catch(() => setErr('无法连接本地服务：请在终端重新运行 bash scripts/start.sh，并保持窗口开着。'));
    api.get('/settings').then((s) => setVoice({ voice: s.ttsVoice })).catch(() => {});
  }, []);
  const T = info?.test;
  const say = (t) => speak(t, { ...voice, rate: 0.95 });
  useEffect(() => { // 进入每一题时自动播放
    if (!T) return;
    if (step === 'shadow') say(T.shadow[i]);
    if (step === 'qa') say(T.questions[i].en);
  }, [step, i]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => { setErr(''); try { await mic.start(); } catch { setErr('无法使用麦克风：请在地址栏左侧允许麦克风权限。'); } };
  async function stop() {
    const rec = await mic.stop();
    if (!rec) return;
    if (rec.seconds < (step === 'mono' ? 10 : 1)) { setErr(step === 'mono' ? '至少说 10 秒，再试一次。' : '录音太短，再试一次。'); return; }
    setBusy('asr'); setErr('');
    try {
      const out = await transcribe(rec.blob);
      if (step === 'shadow') {
        const shadow = [...ids.shadow, out.id]; setIds({ ...ids, shadow });
        if (i < 2) setI(i + 1); else { setStep('mono'); setI(0); }
      } else if (step === 'mono') {
        setIds({ ...ids, mono: out.id }); setStep('qa'); setI(0);
      } else {
        const answers = [...ids.answers, out.id]; const all = { ...ids, answers }; setIds(all);
        if (i < 2) setI(i + 1);
        else { setBusy('save'); setResult(await api.post('/assessment', all)); setStep('done'); }
      }
    } catch (e) { setErr(e.message); }
    setBusy('');
  }

  if (!info) return <div className="narrow">{err && <div className="todo-note">{err}</div>}</div>;
  const milestone = info.due ?? 0;
  const base = info.list.find((a) => a.milestone === 0);
  const recBtn = (label) => (
    <button className="btn accent" onClick={mic.recording ? stop : start} disabled={!!busy}>
      {Icon.mic}{busy === 'asr' ? '识别中…' : busy === 'save' ? '计算结果…' : mic.recording ? `说完了（${Math.floor(mic.seconds)} 秒）` : label}
    </button>
  );
  const progress = { intro: 0, shadow: 1, mono: 2, qa: 3, done: 4 }[step];

  return (
    <div className="narrow">
      <div className="head"><div><h1>{NAME(milestone)}</h1><p className="sub">约 8 分钟。测完得到语速、停顿、口头禅等基线，第 30 / 60 / 90 天用同样题型对比进步。</p></div></div>
      {step !== 'intro' && step !== 'done' && <div className="bar a" style={{ marginBottom: 26 }}><i style={{ width: `${progress * 25}%` }} /></div>}

      {step === 'intro' && <>
        <div className="list">
          {[['跟读 3 句', '看能否完整、清楚地读出日常句子', '2 分钟'], ['1 分钟自我介绍', '测语速、停顿、口头禅', '2 分钟'], ['回答 3 个问题', '听问题后直接用英语回答，测反应和表达', '4 分钟']].map((s, k) => (
            <div className="li" key={k}><span className="num">{k + 1}</span><div className="t"><b>{s[0]}</b><div className="faint">{s[1]}</div></div><span className="faint">{s[2]}</span></div>
          ))}
        </div>
        <p className="faint" style={{ marginTop: 12 }}>找个安静的地方，建议戴耳机。每一步点「开始」说话，说完点「说完了」。</p>
        <div className="row" style={{ marginTop: 22 }}><button className="btn accent" onClick={() => setStep('shadow')}>开始测评</button><Link className="btn line" to="/today">稍后</Link></div>
      </>}

      {step === 'shadow' && <>
        <div className="sec-t">第 1 部分 · 跟读 {i + 1} / 3</div>
        <div className="sent">{T.shadow[i]}</div>
        <div className="row" style={{ marginTop: 20 }}><button className="btn line" onClick={() => say(T.shadow[i])} disabled={mic.recording}>{Icon.speaker}再听一遍</button>{recBtn('开始跟读')}</div>
      </>}

      {step === 'mono' && <>
        <div className="sec-t">第 2 部分 · 1 分钟独白</div>
        <h2 style={{ fontSize: 24 }}>{T.mono.zh}</h2>
        <p className="muted">{T.mono.en}</p>
        <p className="faint" style={{ marginTop: 8 }}>可以说说：{T.mono.hints.join(' · ')}。尽量说满 1 分钟，60 秒会自动结束。</p>
        <div className="row" style={{ marginTop: 20 }}>{recBtn('开始说')}</div>
      </>}

      {step === 'qa' && <>
        <div className="sec-t">第 3 部分 · 回答问题 {i + 1} / 3</div>
        <div className="sent">{T.questions[i].en}</div>
        <details><summary className="faint">看中文</summary><span className="muted">{T.questions[i].zh}</span></details>
        <div className="row" style={{ marginTop: 20 }}><button className="btn line" onClick={() => say(T.questions[i].en)} disabled={mic.recording}>{Icon.speaker}再听一遍</button>{recBtn('开始回答')}</div>
      </>}

      {err && <p style={{ color: 'var(--bad)', fontSize: 13, marginTop: 12 }}>{err}</p>}

      {step === 'done' && result && <>
        <h2>测评完成</h2>
        <div className="kpis" style={{ marginTop: 18 }}>
          {[[result.wpm, '独白语速 词/分', base && milestone ? base.wpm : null], [result.longPauses, '1 分钟长停顿', base && milestone ? base.longPauses : null],
            [result.fillers, '口头禅', base && milestone ? base.fillers : null], [result.shadowAvg ?? '—', '跟读完整度 %', base && milestone ? base.shadowAvg : null]].map((k) => (
            <div key={k[1]}><b>{k[0]}</b><span>{k[1]}</span>{k[2] != null && <div className="faint">入门时 {k[2]}</div>}</div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 14 }}>90 天目标：语速 ≥ 100 词/分，1 分钟长停顿 ≤ 2 次。结果已记入「进度」页。</p>
        <div className="row" style={{ marginTop: 20 }}><Link className="btn accent" to="/today">去今日练习</Link><Link className="btn line" to="/progress">看进度</Link></div>
      </>}
    </div>
  );
}
