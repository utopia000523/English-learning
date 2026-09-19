// AI 情景对话（PRD 3.2）。界面参考 docs/prototype.html「AI 对话」
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../services/api.js';
import { speak } from '../services/tts.js';
import { startRecording, transcribe } from '../services/recorder.js';
import { Icon } from '../icons.jsx';

const LEVEL = { basic: '基础版', advanced: '进阶版' };
const STATUS = {
  passed: <span className="st ok">已通关</span>,
  tried: <span className="st go">练习中</span>,
  open: <span className="st">可练</span>,
  locked: <span className="st lock">未解锁</span>,
};

export function RoleplayList() {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const nav = useNavigate();
  useEffect(() => { api.get('/roleplay/scenes').then(setList).catch(() => setErr('无法连接本地服务：请在终端重新运行 bash scripts/start.sh，并保持窗口开着。')); }, []);
  const open = async (s) => {
    if (s.status === 'locked') return;
    try { const rp = await api.post('/roleplay', { sceneId: s.id }); nav(`/roleplay/${rp.id}`, { state: { fresh: true } }); }
    catch (e) { setErr(e.message); }
  };
  return (
    <div className="narrow">
      <div className="head"><div><h1>AI 情景对话</h1><p className="sub">AI 扮演角色，你用英语完成任务。对话中不打断纠错，结束后统一复盘。</p></div></div>
      {err && <div className="todo-note">{err}</div>}
      {list && (
        <div className="list">
          {list.map((s) => (
            <div key={s.id} className="li" style={s.status === 'locked' ? { opacity: 0.55 } : { cursor: 'pointer' }} onClick={() => open(s)}>
              <span className="faint" style={{ width: 48 }}>第 {s.week} 周</span>
              <div className="t"><b>{s.title}</b><div className="faint">AI 角色：{s.roleZh} · {LEVEL[s.level]}</div></div>
              {STATUS[s.status]}
            </div>
          ))}
        </div>
      )}
      <p className="faint" style={{ marginTop: 12 }}>当前周及以前的场景可练，之后的到对应周解锁。</p>
    </div>
  );
}

function Review({ rp, onClose, onAgain }) {
  const [added, setAdded] = useState({});
  const r = rp.review || { fixes: [] };
  const n = rp.scene.tasks.length;
  const add = async (f, i) => {
    await api.post('/cards', { en: f.better, zh: f.zh, source: 'AI 对话', scene: rp.scene.title });
    setAdded((a) => ({ ...a, [i]: true }));
  };
  return (
    <div className="mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>对话复盘 · {rp.scene.title}</h2>
        <p className="sub">{rp.passed ? '已通关' : '未通关'} · 任务 {rp.tasksDone.length}/{n} · {rp.turns} 轮
          {!rp.passed && <span className="faint">（通关需完成全部任务，且对话 ≥ {rp.passTurns} 轮）</span>}</p>
        {r.comment_zh && <p style={{ marginTop: 10 }}>{r.comment_zh}</p>}
        {r.fluency && <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>语音部分：语速 {r.fluency.wpm} 词/分 · 长停顿 {r.fluency.longPauses} 次 · 口头禅 {r.fluency.fillers} 次（{r.fluency.segments} 句语音）</p>}
        {r.fixes.length === 0 && rp.turns > 0 && <p className="muted" style={{ marginTop: 16 }}>这次说的句子都很自然，没有需要改的。</p>}
        {r.fixes.length > 0 && <>
          <div className="sec-t" style={{ marginTop: 22 }}>需要改进的句子（{r.fixes.length}）</div>
          <div style={{ borderTop: '1px solid var(--line)' }}>
            {r.fixes.map((f, i) => (
              <div className="fix" key={i}>
                <div><div className="o">{f.you}</div><div className="n">{f.better}</div>{f.issue_zh && <div className="muted" style={{ fontSize: 13 }}>{f.issue_zh}</div>}<div className="faint">{f.zh}</div></div>
                <div className="row" style={{ gap: 2 }}>
                  <button className="link" onClick={() => speak(f.better)}>{Icon.speaker}</button>
                  <button className="link" disabled={added[i]} onClick={() => add(f, i)}>{added[i] ? '已加入' : '+ 加入表达卡'}</button>
                </div>
              </div>
            ))}
          </div>
        </>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 22 }}>
          <button className="btn line" onClick={onAgain}>再练一次</button>
          <Link className="btn accent" to="/roleplay">返回场景</Link>
        </div>
      </div>
    </div>
  );
}

export function RoleplayChat() {
  const { id } = useParams();
  const nav = useNavigate();
  const [rp, setRp] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [rate, setRate] = useState(1);
  const [voice, setVoice] = useState({});
  const [showZh, setShowZh] = useState({});
  const [showReview, setShowReview] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const recRef = useRef(null);
  const [rec, setRec] = useState(0);        // 录音中：已录秒数；0 = 未录音
  const [recId, setRecId] = useState(null); // 最近一次识别的录音 id，随本轮发送
  const [fbPending, setFbPending] = useState({}); // 正在点评的消息序号
  const [added, setAdded] = useState({});

  const addCard = async (i, fb) => {
    await api.post('/cards', { en: fb.better, zh: fb.zh, source: 'AI 对话', scene: rp.scene.title });
    setAdded((a) => ({ ...a, [i]: true }));
  };
  // 每句点评：AI 回复后再在后台检查（不拖慢回复），结果直接展开
  const runFeedback = async (idx) => {
    setFbPending((p) => ({ ...p, [idx]: true }));
    try {
      const fb = await api.post(`/roleplay/${id}/feedback`, { index: idx });
      setRp((r) => ({ ...r, feedback: { ...r.feedback, [idx]: fb } }));
    } catch { /* 点评失败不影响对话 */ }
    setFbPending((p) => ({ ...p, [idx]: false }));
  };
  const say = (t, r = rate) => t && speak(t, { voice: voice.voice, rate: r * (voice.rate || 1) });

  useEffect(() => {
    let s = {};
    api.get('/settings').then((x) => { s = { voice: x.ttsVoice, rate: x.ttsRate }; setVoice(s); }).catch(() => {}).finally(() =>
      api.get(`/roleplay/${id}`).then((r) => {
        setRp(r);
        if (r.ended) setShowReview(true);
        else if (r.messages.length === 1) speak(r.messages[0].content, { voice: s.voice, rate: s.rate || 1 });
      }).catch((e) => setErr(e.message)));
  }, [id]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [rp?.messages.length, busy]);

  useEffect(() => {
    if (!rec) return undefined;
    const t = setInterval(() => {
      const sec = recRef.current?.seconds() || 0;
      setRec(Math.max(0.1, sec));
      if (sec >= 60) toggleMic(); // 最长 60 秒自动结束
    }, 200);
    return () => clearInterval(t);
  });
  useEffect(() => () => recRef.current?.cancel(), []);

  const toggleMic = async () => {
    setErr('');
    if (!recRef.current) {
      try { recRef.current = await startRecording(); setRec(0.1); }
      catch { setErr('无法使用麦克风：请在浏览器地址栏左侧允许麦克风权限后重试。'); }
      return;
    }
    const r = recRef.current; recRef.current = null; setRec(0);
    if (r.seconds() < 0.6) { r.cancel(); return; }
    setBusy('asr');
    try {
      const out = await transcribe(await r.stop());
      if (!out.text) setErr('没有听清，请再说一遍。');
      else { setText((t) => (t ? t + ' ' : '') + out.text); setRecId(out.id); }
    } catch (e) { setErr(e.message); }
    setBusy('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const send = async () => {
    const t = text.trim();
    if (!t || busy || rec) return;
    const recordingId = recId;
    setErr(''); setBusy('reply'); setText(''); setRecId(null);
    setRp((r) => ({ ...r, messages: [...r.messages, { role: 'user', content: t }] }));
    try {
      const r = await api.post(`/roleplay/${id}/turn`, { text: t, recordingId });
      setRp(r);
      say(r.messages[r.messages.length - 1].content);
      const idx = r.messages.length - 2;
      api.post(`/roleplay/${id}/tasks`).then((t) => setRp((x) => ({ ...x, tasksDone: t.tasksDone }))).catch(() => {})
        .finally(() => runFeedback(idx));
    } catch (e) {
      setErr(e.message); setText(t);
      setRp((r) => ({ ...r, messages: r.messages.slice(0, -1) }));
    }
    setBusy('');
  };
  const finish = async () => {
    setErr(''); setBusy('review');
    try { setRp(await api.post(`/roleplay/${id}/finish`)); setShowReview(true); } catch (e) { setErr(e.message); }
    setBusy('');
  };
  const again = async () => {
    const n = await api.post('/roleplay', { sceneId: rp.scene.id });
    setShowReview(false); nav(`/roleplay/${n.id}`);
  };

  if (!rp) return <div className="narrow">{err && <div className="todo-note">{err}</div>}</div>;
  const sc = rp.scene;
  return (
    <div className="chat-page">
      <div className="chat-col">
        <div className="chat-head">
          <div className="ttl">
            <Link className="link" to="/roleplay" title="返回场景">{Icon.back}</Link>
            <b style={{ fontWeight: 500 }}>{sc.title} · {LEVEL[sc.level]}</b><span className="faint">第 {sc.week} 周</span>
          </div>
          <div className="row">
            <div className="seg">{[0.8, 1].map((r) => <button key={r} className={rate === r ? 'on' : ''} onClick={() => setRate(r)}>{r === 1 ? '1.0' : r}x</button>)}</div>
            {!rp.ended && <button className="btn line sm" disabled={!!busy} onClick={finish}>{busy === 'review' ? '正在复盘…' : '结束并复盘'}</button>}
            {rp.ended && <button className="btn line sm" onClick={() => setShowReview(true)}>查看复盘</button>}
          </div>
        </div>
        <div className="msgs">
          {rp.messages.map((m, i) => m.role === 'user' ? (
            <div className="me" key={i}>
              <div className="bub">{m.content}</div>
              {fbPending[i] && <div className="fb-ok faint">检查表达中…</div>}
              {rp.feedback?.[i]?.ok && <div className="fb-ok">✓ 表达自然</div>}
              {rp.feedback?.[i] && !rp.feedback[i].ok && (
                <div className="fb">
                  <div className="faint">可以更地道</div>
                  <div className="n">{rp.feedback[i].better}</div>
                  {rp.feedback[i].issue_zh && <div className="muted">{rp.feedback[i].issue_zh}</div>}
                  <div className="row" style={{ gap: 2, marginTop: 2, marginLeft: -6 }}>
                    <button className="link" onClick={() => say(rp.feedback[i].better)}>{Icon.speaker}朗读</button>
                    <button className="link" disabled={added[i]} onClick={() => addCard(i, rp.feedback[i])}>{added[i] ? '已加入表达卡' : '+ 加入表达卡'}</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="ai" key={i}>
              {m.content && <>
                <div className="who">{sc.role_zh}</div>
                {m.content}
                <div className="tools">
                  <button className="link" onClick={() => say(m.content)}>{Icon.speaker}再听</button>
                  <button className="link" onClick={() => say(m.content, 0.7)}>慢速</button>
                  {m.zh && <button className="link" onClick={() => setShowZh((z) => ({ ...z, [i]: !z[i] }))}>中文</button>}
                </div>
                {showZh[i] && <div className="zh">{m.zh}</div>}
              </>}
              {m.coach && <div className="aside-note" style={{ marginTop: 8 }}>可以说 <b style={{ color: 'var(--ink)' }}>“{m.coach}”</b>
                <button className="link" onClick={() => say(m.coach)}>{Icon.speaker}</button> 试着把整句再说一遍。</div>}
            </div>
          ))}
          {busy === 'reply' && <div className="ai"><div className="who">{sc.role_zh}</div><span className="faint">正在回复…</span></div>}
          <div ref={endRef} />
        </div>
        {err && <p style={{ color: 'var(--bad)', fontSize: 13, marginBottom: 8 }}>{err}</p>}
        {!rp.ended && (
          <div className="composer">
            <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} disabled={!!busy || !!rec} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }}
              placeholder={rec ? `正在听… ${Math.floor(rec)} 秒，说完再点一次麦克风` : busy === 'asr' ? '正在识别…' : '点麦克风用英语说，识别后可修改；也可以直接输入，按回车发送'} />
            <div className="bar2">
              <span className="faint">说不出来可以直接打中文，AI 会告诉你英文怎么说</span>
              <div className="row" style={{ gap: 6 }}>
              <button className={`micbtn ${rec ? 'rec' : ''}`} onClick={toggleMic} disabled={busy === 'reply' || busy === 'review' || busy === 'asr'} title={rec ? '结束录音' : '开始说话'}>{Icon.mic}</button>
              <button className="send" onClick={send} disabled={!!busy || !!rec || !text.trim()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
              </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <aside className="panel">
        <details open>
          <summary>任务 <span className="faint">{rp.tasksDone.length} / {sc.tasks.length}</span></summary>
          <div className="pb">
            {sc.tasks.map((t, i) => {
              const on = rp.tasksDone.includes(i + 1);
              return <div className={`chk ${on ? 'on' : ''}`} key={i}><span className={`cb ${on ? 'on' : ''}`} /><span>{t.zh}</span></div>;
            })}
            <p className="faint" style={{ marginTop: 8 }}>通关：任务全部完成，且对话 ≥ {rp.passTurns} 轮（当前 {rp.turns} 轮）</p>
          </div>
        </details>
        <details>
          <summary>提示</summary>
          <div className="pb">
            {(sc.hints || []).map((h, i) => (
              <div className="hintline" key={i}>{h.zh}<details><summary>看英文</summary><b>{h.en}</b></details></div>
            ))}
          </div>
        </details>
        <details open>
          <summary>场景</summary>
          <div className="pb muted">{sc.brief}</div>
        </details>
      </aside>
      {showReview && <Review rp={rp} onClose={() => setShowReview(false)} onAgain={again} />}
    </div>
  );
}
