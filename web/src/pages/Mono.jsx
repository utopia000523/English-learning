// 话题独白（PRD 3.5）：30 秒准备 → 说 1 分钟 → 流利度 + AI 地道改写。界面参考 docs/prototype.html「独白」
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { speak } from '../services/tts.js';
import { transcribe } from '../services/recorder.js';
import { useMic } from '../services/useMic.js';
import { Icon } from '../icons.jsx';

const PREP = 30; const TALK = 60;
const n = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

/** 标出改写版里新增/改动的词（与原话做最长公共子序列比较） */
function markChanges(orig, rewrite) {
  const a = orig.split(/\s+/).map(n).filter(Boolean);
  const b = rewrite.split(/\s+/).filter(Boolean);
  const bn = b.map(n);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    dp[i][j] = a[i] === bn[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keep = new Set(); let i = 0; let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === bn[j]) { keep.add(j); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return b.map((w, k) => ({ w, mark: !keep.has(k) && !!bn[k] }));
}

export default function Mono() {
  const [topics, setTopics] = useState(null);
  const [topic, setTopic] = useState(null);
  const [step, setStep] = useState('prep'); // prep → talk → wait → done
  const [prepLeft, setPrepLeft] = useState(PREP);
  const [res, setRes] = useState(null);
  const [myUrl, setMyUrl] = useState('');
  const [err, setErr] = useState('');
  const [added, setAdded] = useState({});
  const [voice, setVoice] = useState({});
  const stopping = useRef(false);

  const pick = (list, exclude) => {
    const pool = list.filter((t) => t.id !== exclude);
    return (pool.length ? pool : list)[Math.floor(Math.random() * (pool.length || list.length))];
  };
  useEffect(() => {
    api.get('/mono/topics').then((l) => { setTopics(l); setTopic(pick(l)); })
      .catch(() => setErr('无法连接本地服务：请在终端重新运行 bash scripts/start.sh，并保持窗口开着。'));
    api.get('/settings').then((s) => setVoice({ voice: s.ttsVoice, rate: s.ttsRate })).catch(() => {});
  }, []);

  const finish = useCallback(async () => {
    if (stopping.current) return;
    stopping.current = true;
    const rec = await mic.stop();
    setStep('wait');
    try {
      if (!rec || rec.seconds < 3) throw new Error('录音太短，请再试一次。');
      setMyUrl(rec.url);
      const asr = await transcribe(rec.blob);
      if (!asr.text) throw new Error('没有听清，请再试一次。');
      setRes(await api.post('/mono', { topicId: topic.id, recordingId: asr.id }));
      setStep('done');
    } catch (e) { setErr(e.message); setStep('prep'); setPrepLeft(PREP); }
    stopping.current = false;
  }, [topic]); // eslint-disable-line react-hooks/exhaustive-deps
  const mic = useMic({ maxSeconds: TALK, onAutoStop: finish });

  // 准备倒计时，结束自动开始录音
  useEffect(() => {
    if (step !== 'prep' || !topic) return undefined;
    if (prepLeft <= 0) { startTalk(); return undefined; }
    const t = setTimeout(() => setPrepLeft((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [step, prepLeft, topic]); // eslint-disable-line react-hooks/exhaustive-deps

  const startTalk = async () => {
    setErr('');
    try { await mic.start(); setStep('talk'); }
    catch { setErr('无法使用麦克风：请在地址栏左侧允许麦克风权限。'); setStep('prep'); setPrepLeft(PREP); }
  };
  const reset = (newTopic) => {
    mic.cancel(); setRes(null); setMyUrl(''); setErr(''); setAdded({});
    if (newTopic) setTopic(pick(topics, topic?.id));
    setStep('prep'); setPrepLeft(PREP);
  };
  const addCard = async (p, i) => {
    await api.post('/cards', { en: p.en, zh: p.zh, source: '独白', scene: topic.zh });
    setAdded((a) => ({ ...a, [i]: true }));
  };

  if (err && !topics) return <div className="narrow"><div className="todo-note">{err}</div></div>;
  if (!topic) return null;
  const left = step === 'prep' ? prepLeft : step === 'talk' ? Math.max(0, TALK - Math.floor(mic.seconds)) : 0;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <>
      <div className="head"><div><h1>话题独白</h1><p className="sub">30 秒准备，说满 1 分钟。重点是说得久，不怕说错。</p></div></div>
      <div className="two" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ textAlign: 'center', paddingTop: 10 }}>
          <p className="faint">第 {topic.week} 周 · 1 分钟</p>
          <h2 style={{ fontSize: 24, margin: '10px 0 4px' }}>{topic.zh}</h2>
          <p className="muted">{topic.en}</p>
          <p className="faint" style={{ marginTop: 12 }}>可以说说：{topic.hints.join(' · ')}</p>
          <div className="timer">{step === 'done' ? '1:00' : clock}</div>
          <p className="faint">{{ prep: '准备中，时间到自动开始录音', talk: '正在录音…', wait: '正在识别和改写…', done: '已完成' }[step]}</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
            {step === 'prep' && <><button className="btn line" onClick={() => reset(true)}>换个话题</button><button className="btn accent" onClick={startTalk}>{Icon.mic}现在开始说</button></>}
            {step === 'talk' && <button className="btn accent" onClick={finish}>说完了</button>}
            {step === 'done' && <><button className="btn line" onClick={() => reset(false)}>再说一次</button><button className="btn line" onClick={() => reset(true)}>换个话题</button></>}
          </div>
          {err && <p style={{ color: 'var(--bad)', fontSize: 13, marginTop: 12 }}>{err}</p>}
        </div>
        <div style={{ borderLeft: '1px solid var(--line)', paddingLeft: 40 }}>
          {!res ? <p className="muted" style={{ paddingTop: 14 }}>说完后，这里会显示识别文字、语速和停顿，以及 AI 改写的地道版本。</p> : (
            <div className="rewrite">
              <p className="muted" style={{ margin: '0 0 12px' }}>语速 {res.wpm} 词/分 · 长停顿 {res.longPauses} 次 · 口头禅 {res.fillers} 次</p>
              {res.comment_zh && <p style={{ margin: '0 0 18px' }}>{res.comment_zh}</p>}
              <div className="sec-t"><span>你说的</span>{myUrl && <button className="link" onClick={() => new Audio(myUrl).play()}>{Icon.speaker}回放</button>}</div>
              <p className="muted">{res.transcript}</p>
              {res.rewrite && <>
                <div className="sec-t"><span>地道版本</span><button className="link" onClick={() => speak(res.rewrite, voice)}>{Icon.speaker}朗读</button></div>
                <p className="serif">{markChanges(res.transcript, res.rewrite).map((x, i) => <span key={i}>{x.mark ? <mark>{x.w}</mark> : x.w} </span>)}</p>
              </>}
              {res.phrases.length > 0 && <>
                <div className="sec-t">值得学的表达</div>
                <div className="list">
                  {res.phrases.map((p, i) => (
                    <div className="li" key={i} style={{ padding: '10px 2px' }}>
                      <div className="t"><span style={{ fontFamily: 'var(--serif)', fontSize: 15 }}>{p.en}</span> <span className="faint">{p.zh}</span></div>
                      <button className="link" onClick={() => speak(p.en, voice)}>{Icon.speaker}</button>
                      <button className="link" disabled={added[i]} onClick={() => addCard(p, i)}>{added[i] ? '已加入' : '+ 表达卡'}</button>
                    </div>
                  ))}
                </div>
              </>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
