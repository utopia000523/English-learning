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
          ? <div className="field"><div>本地服务</div><span className="st go">无法连接</span></div>
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
            <button className="link" onClick={() => speak('Hi there! What can I get for you today?', { voice: s.ttsVoice, rate: s.ttsRate })}>试听</button>
          </div>
        </div>
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
          <div>每日提醒</div>
          <input className="in" type="time" value={s.reminderTime} onChange={(e) => save({ reminderTime: e.target.value })} />
        </div>
      </div>

      <div className="set-group">
        <h3>Notion 同步</h3>
        <div className="field">
          <div><div>Integration Token</div><div className="d">{s.notionTokenSet ? '已填写，如需更换请重新输入' : '在 Notion 设置 → 集成 中创建'}</div></div>
          <div className="row">
            <input className="in" type="password" placeholder="secret_..." value={token} onChange={(e) => setToken(e.target.value)} style={{ width: 200 }} />
            <button className="link" onClick={async () => { await save({ notionToken: token.trim() }); setToken(''); check(); }}>保存</button>
          </div>
        </div>
        <div className="fixhint">选择数据库、自动同步在阶段 5 实现。</div>
      </div>
    </div>
  );
}
