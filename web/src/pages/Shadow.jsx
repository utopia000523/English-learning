// 跟读（PRD 3.4）：逐句跟读 / 影子跟读。界面参考 docs/prototype.html「跟读」
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api.js';
import { speak } from '../services/tts.js';
import { transcribe } from '../services/recorder.js';
import { useMic } from '../services/useMic.js';
import { Icon } from '../icons.jsx';

const CLS = { ok: 'w-ok', unsure: 'w-mid', missed: 'w-bad', wrong: 'w-bad' };

function Sentence({ text, result, hidden }) {
  if (hidden && !result) return <div className="sent faint">（原文已隐藏，先听再跟）</div>;
  if (!result) return <div className="sent">{text}</div>;
  return <div className="sent">{result.align.map((w, i) => <span key={i} className={CLS[w.status]}>{w.word} </span>)}</div>;
}

export default function Shadow() {
  const [list, setList] = useState(null);
  const [mid, setMid] = useState('');
  const [mode, setMode] = useState('line'); // line 逐句 / shadow 影子
  const [idx, setIdx] = useState(0);
  const [rate, setRate] = useState(1);
  const [hide, setHide] = useState(false);
  const [voice, setVoice] = useState({});
  const [results, setResults] = useState({}); // key: 句子序号 或 'all'
  const [myUrl, setMyUrl] = useState({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const mic = useMic({ maxSeconds: 90 });
  const [params] = useSearchParams();

  useEffect(() => {
    api.get('/shadow').then((l) => { setList(l); const want = l.find((m) => m.id === params.get('m') && !m.locked); const first = want || l.find((m) => !m.locked); if (first) setMid(first.id); })
      .catch(() => setErr('无法连接本地服务：请在终端重新运行 bash scripts/start.sh，并保持窗口开着。'));
    api.get('/settings').then((s) => setVoice({ voice: s.ttsVoice })).catch(() => {});
  }, []);
  useEffect(() => { setIdx(0); setResults({}); setMyUrl({}); setHide(mode === 'shadow'); }, [mid, mode]);

  const mat = list?.find((m) => m.id === mid);
  const sents = mat?.sentences || [];
  const cur = sents[idx];
  const play = (t) => speak(t, { voice: voice.voice, rate });

  const score = async (key, reference, rec) => {
    setBusy('score');
    try {
      const asr = await transcribe(rec.blob);
      const r = await api.post('/shadow/score', { recordingId: asr.id, reference });
      setResults((x) => ({ ...x, [key]: { ...r, heard: asr.text } }));
      setMyUrl((x) => ({ ...x, [key]: rec.url }));
    } catch (e) { setErr(e.message); }
    setBusy('');
  };

  // 逐句：点一下开始跟读，再点一下结束
  const toggleLine = async () => {
    setErr('');
    if (!mic.recording) { try { window.speechSynthesis?.cancel(); await mic.start(); } catch { setErr('无法使用麦克风：请在地址栏左侧允许麦克风权限。'); } return; }
    const rec = await mic.stop();
    if (rec && rec.seconds > 0.5) score(idx, cur.en, rec);
  };

  // 影子：开始录音，同时连续播放全部句子，播完自动结束评分
  const runShadow = async () => {
    setErr(''); setResults({});
    try { await mic.start(); } catch { setErr('无法使用麦克风：请在地址栏左侧允许麦克风权限。'); return; }
    setBusy('playing');
    for (let i = 0; i < sents.length; i++) { setIdx(i); await play(sents[i].en); }
    await new Promise((r) => setTimeout(r, 1500));
    setBusy('');
    const rec = await mic.stop();
    if (rec) score('all', sents.map((s) => s.en).join(' '), rec);
  };

  if (err && !list) return <div className="narrow"><div className="todo-note">{err}</div></div>;
  if (!list) return null;
  const r = mode === 'line' ? results[idx] : results.all;
  const fmt = (ms) => `${(ms / 1000).toFixed(1)} 秒`;

  return (
    <>
      <div className="head">
        <div><h1>跟读</h1><p className="sub">{mat ? `${mat.title} · ${sents.length} 句` : '暂无材料'}</p></div>
        <div className="row">
          <select className="in" value={mid} onChange={(e) => setMid(e.target.value)}>
            {list.map((m) => <option key={m.id} value={m.id} disabled={m.locked}>第 {m.week} 周 · {m.title}{m.locked ? '（未解锁）' : ''}</option>)}
          </select>
          <div className="seg">
            <button className={mode === 'line' ? 'on' : ''} onClick={() => setMode('line')}>逐句跟读</button>
            <button className={mode === 'shadow' ? 'on' : ''} onClick={() => setMode('shadow')}>影子跟读</button>
          </div>
        </div>
      </div>
      {mat && (
        <div className="two">
          <div>
            <div className="row between">
              <span className="faint">{mode === 'line' ? `第 ${idx + 1} / ${sents.length} 句` : '影子跟读：原文隐藏，跟着音频同步说（请戴耳机）'}</span>
              <div className="row" style={{ gap: 6 }}>
                <div className="seg">{[0.75, 1, 1.2].map((x) => <button key={x} className={rate === x ? 'on' : ''} onClick={() => setRate(x)}>{x === 1 ? '1.0' : x}x</button>)}</div>
                <button className="link" onClick={() => setHide((h) => !h)}>{hide ? '显示原文' : '隐藏原文'}</button>
              </div>
            </div>

            {mode === 'line' ? <>
              <Sentence text={cur.en} result={r} hidden={hide} />
              <div className="muted">{cur.zh}</div>
              <div className="row" style={{ marginTop: 24 }}>
                <button className="btn line" onClick={() => play(cur.en)} disabled={mic.recording}>{Icon.speaker}听原句</button>
                <button className="btn accent" onClick={toggleLine} disabled={busy === 'score'}>{Icon.mic}{mic.recording ? `说完了（${Math.floor(mic.seconds)} 秒）` : busy === 'score' ? '评分中…' : '我来跟读'}</button>
                {myUrl[idx] && <button className="btn line" onClick={() => new Audio(myUrl[idx]).play()}>回放我的</button>}
                <span style={{ marginLeft: 'auto' }} className="row">
                  <button className="link" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← 上一句</button>
                  <button className="link" disabled={idx >= sents.length - 1} onClick={() => setIdx(idx + 1)}>下一句 →</button>
                </span>
              </div>
            </> : <>
              <div className="sent">{hide && !r ? <span className="faint">（原文已隐藏）第 {idx + 1} / {sents.length} 句</span> : r ? <span>{r.align.map((w, i) => <span key={i} className={CLS[w.status]}>{w.word} </span>)}</span> : sents.map((s) => s.en).join(' ')}</div>
              <div className="row" style={{ marginTop: 24 }}>
                <button className="btn accent" onClick={runShadow} disabled={mic.recording || !!busy}>{Icon.mic}{busy === 'playing' ? `跟着说…（${Math.floor(mic.seconds)} 秒）` : busy === 'score' ? '评分中…' : r ? '再来一遍' : '开始影子跟读'}</button>
                {myUrl.all && <button className="btn line" onClick={() => new Audio(myUrl.all).play()}>回放我的</button>}
              </div>
            </>}

            {err && <p style={{ color: 'var(--bad)', fontSize: 13, marginTop: 12 }}>{err}</p>}
            {r && <>
              <hr />
              <p><b style={{ fontWeight: 500 }}>{mode === 'line' ? '本句' : '整段'}</b> <span className="muted">完整度 {r.completeness} · 漏读 {r.missed.length} 词 · 读错 {r.wrong.length} 词 · 最长停顿 {fmt(r.maxPauseMs)}{mode === 'shadow' ? ` · 语速 ${r.wpm} 词/分` : ''}</span></p>
              {r.missed.length > 0 && <p className="muted" style={{ marginTop: 6 }}>漏读：{r.missed.join('、')}</p>}
              {r.wrong.length > 0 && <p className="muted" style={{ marginTop: 4 }}>读错：{r.wrong.map((w) => `${w.word}（听成 ${w.heard}）`).join('、')}</p>}
              <p className="faint" style={{ marginTop: 6 }}>识别结果：{r.heard}</p>
            </>}
            <p className="faint" style={{ marginTop: 14 }}><span className="w-mid">黄色</span> 识别不确定　<span className="w-bad">红色</span> 漏读或读错　· 评分仅作练习参考</p>
          </div>
          <div>
            <div className="sec-t">本组进度</div>
            <div className="list">
              {sents.map((s, i) => (
                <div key={i} className="li" style={{ padding: '11px 2px', cursor: mode === 'line' ? 'pointer' : 'default' }} onClick={() => mode === 'line' && setIdx(i)}>
                  <span className="num">{i + 1}</span>
                  <div className="t">{hide && mode === 'shadow' ? '· · ·' : s.en}</div>
                  {mode === 'line' && (i === idx ? <span className="st go">当前</span> : results[i] ? <span className="faint">{results[i].completeness}</span> : null)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
