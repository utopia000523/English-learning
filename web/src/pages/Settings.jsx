import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { voicesReady, speak } from '../services/tts.js';

function StatusRow({ name, st }) {
  if (!st) return <div className="field"><div>{name}</div><span className="faint">检测中…</span></div>;
  return (
    <div className="field">
      <div>
        <div>{name}</div>
        <div className="d">{st.detail}</div>
        {!st.ok && st.fix && <div className="fixhint">解决方法：{st.fix}</div>}
      </div>
      <span className={`st ${st.ok ? 'ok' : st.optional ? '' : 'go'}`}>{st.ok ? '已就绪' : st.optional ? '可选' : '未就绪'}</span>
    </div>
  );
}

export default function Settings() {
  const [health, setHealth] = useState(null);
  const [tts, setTts] = useState(null);
  const [voices, setVoices] = useState([]);
  const [s, setS] = useState(null);
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState('');
  const [voiceMsg, setVoiceMsg] = useState('');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [notionMsg, setNotionMsg] = useState('');

  const check = async () => {
    setHealth(null);
    try { setHealth(await api.get('/health')); } catch { setHealth({ error: true }); }
    const v = await voicesReady();
    setVoices(v);
    setTts(v.length
      ? { ok: true, detail: `系统英语声音 ${v.length} 个` }
      : { ok: false, detail: '未找到英语声音', fix: '系统设置 → 辅助功能 → 朗读内容 → 管理声音，下载英语（美国）增强版' });
  };
  useEffect(() => { check(); api.get('/settings').then(setS); }, []);

  const save = async (patch) => {
    setS(await api.put('/settings', patch));
    setSaved('已保存'); setTimeout(() => setSaved(''), 1500);
  };
  if (!s) return null;

  return (
    <div className="narrow">
      <div className="head"><div><h1>设置</h1><p className="sub">所有练习能力都在本机运行，断网也能用。</p></div><span className="faint">{saved}</span></div>

      <div className="set-group">
        <div className="row between"><h3>本地模型与服务</h3><button className="link" onClick={check}>重新检测</button></div>
        {health?.error
          ? <div className="field"><div><div>本地服务</div><div className="fixhint">解决方法：在终端重新运行 bash scripts/start.sh，使用期间保持该终端窗口开着</div></div><span className="st go">无法连接</span></div>
          : <>
              <StatusRow name="对话模型" st={health?.llm} />
              <StatusRow name="语音识别" st={health?.asr} />
              <StatusRow name="朗读声音" st={tts} />
              <StatusRow name="Notion" st={health?.notion} />
            </>}
        <div className="field">
          <div><div>对话模型名称</div><div className="d">Ollama 中的模型名，改完点别处即保存，再点「重新检测」</div></div>
          <input className="in" defaultValue={s.llmModel} onBlur={(e) => e.target.value !== s.llmModel && save({ llmModel: e.target.value.trim() })} style={{ width: 180 }} />
        </div>
      </div>

      <div className="set-group">
        <h3>声音</h3>
        <div className="field">
          <div>朗读声音</div>
          <div className="row">
            <select className="in" value={s.ttsVoice} onChange={(e) => save({ ttsVoice: e.target.value })}>
              <option value="">自动（美音女声）</option>
              {voices.map((v) => <option key={v.name} value={v.name}>{v.name} · {v.lang}</option>)}
            </select>
            <button className="link" onClick={async () => {
              setVoiceMsg('');
              const r = await speak('Hi there! What can I get for you today?', { voice: s.ttsVoice, rate: s.ttsRate });
              if (!r.ok) setVoiceMsg(r.online ? '这个声音需要联网，当前无法使用。请联网，或换成本机声音（名称不带 Google 的）。' : '朗读失败，请换一个声音再试。');
            }}>试听</button>
          </div>
        </div>
        {voiceMsg && <div className="fixhint" style={{ color: 'var(--bad)' }}>{voiceMsg}</div>}
        <div className="field">
          <div>默认语速</div>
          <div className="seg">
            {[0.75, 1].map((r) => <button key={r} className={s.ttsRate === r ? 'on' : ''} onClick={() => save({ ttsRate: r })}>{r === 1 ? '1.0' : r}x</button>)}
          </div>
        </div>
      </div>

      <div className="set-group">
        <h3>学习</h3>
        <div className="field">
          <div>每日时长</div>
          <select className="in" value={s.dailyMinutes} onChange={(e) => save({ dailyMinutes: Number(e.target.value) })}>
            {[20, 30, 45].map((m) => <option key={m} value={m}>{m} 分钟</option>)}
          </select>
        </div>
        <div className="field">
          <div><div>每日新卡</div><div className="d">表达卡每天最多学几张新卡</div></div>
          <div className="row" style={{ gap: 6 }}>
            <input className="in" type="number" min="0" max="200" defaultValue={s.cardsNewPerDay} style={{ width: 80 }}
              onBlur={(e) => { const v = Math.max(0, Math.min(200, Number(e.target.value) || 0)); if (v !== s.cardsNewPerDay) save({ cardsNewPerDay: v }); }} />
            <span className="faint">张</span>
          </div>
        </div>
        <div className="field">
          <div><div>每日总张数</div><div className="d">复习卡加新卡，每天最多几张；填 0 表示不限</div></div>
          <div className="row" style={{ gap: 6 }}>
            <input className="in" type="number" min="0" max="500" defaultValue={s.cardsDailyMax} style={{ width: 80 }}
              onBlur={(e) => { const v = Math.max(0, Math.min(500, Number(e.target.value) || 0)); if (v !== s.cardsDailyMax) save({ cardsDailyMax: v }); }} />
            <span className="faint">张</span>
          </div>
        </div>
        <div className="field">
          <div>每日提醒</div>
          <input className="in" type="time" value={s.reminderTime} onChange={(e) => save({ reminderTime: e.target.value })} />
        </div>
      </div>

      <div className="set-group">
        <h3>Notion 同步</h3>
        <p className="faint" style={{ marginBottom: 4 }}>把笔记本和每日练习记录单向同步到 Notion，手机上用 Notion 查看。本地数据为准，Notion 里改动不会同步回来。</p>
        <div className="field">
          <div><div>1. Integration Token</div><div className="d">{s.notionTokenSet ? '已填写，如需更换请重新输入' : '在 notion.so/my-integrations 新建一个 Internal 集成，复制 Token'}</div></div>
          <div className="row">
            <input className="in" type="password" placeholder="ntn_... 或 secret_..." value={token} onChange={(e) => setToken(e.target.value)} style={{ width: 200 }} />
            <button className="link" onClick={async () => { await save({ notionToken: token.trim() }); setToken(''); check(); }}>保存</button>
          </div>
        </div>
        <div className="field">
          <div><div>2. 放数据库的页面</div><div className="d">{s.notionNotesDb ? '已创建「口语笔记」「每日练习记录」两个数据库' : '在 Notion 新建一个页面，右上角 ··· → 连接 → 选择你的集成，然后粘贴页面链接'}</div></div>
          <div className="row">
            <input className="in" placeholder="Notion 页面链接" value={parent} onChange={(e) => setParent(e.target.value)} style={{ width: 200 }} />
            <button className="link" disabled={!s.notionTokenSet || !parent.trim() || busy} onClick={async () => {
              setBusy(true); setNotionMsg('');
              try { setS(await api.post('/notion/setup', { parent })); setParent(''); setNotionMsg('数据库已创建'); check(); } catch (e) { setNotionMsg(e.message); }
              setBusy(false);
            }}>{s.notionNotesDb ? '重新创建' : '创建数据库'}</button>
          </div>
        </div>
        <div className="field">
          <div><div>3. 同步</div><div className="d">{s.notionLastSync ? `上次同步 ${s.notionLastSync}` : '还没同步过'}；每 10 分钟和完成每日收尾时自动同步，断网时排队</div></div>
          <div className="row">
            <label className="row faint" style={{ gap: 6 }}><input type="checkbox" checked={!!s.notionAutoSync} onChange={(e) => save({ notionAutoSync: e.target.checked })} />自动同步</label>
            <button className="link" disabled={!s.notionNotesDb || busy} onClick={async () => {
              setBusy(true); setNotionMsg('');
              try { const r = await api.post('/notion/sync'); setNotionMsg(`已同步：笔记 ${r.notes} 条，每日记录 ${r.days} 天`); setS(await api.get('/settings')); } catch (e) { setNotionMsg(e.message); }
              setBusy(false);
            }}>{busy ? '处理中…' : '立即同步'}</button>
          </div>
        </div>
        {notionMsg && <div className="fixhint">{notionMsg}</div>}
      </div>
    </div>
  );
}
