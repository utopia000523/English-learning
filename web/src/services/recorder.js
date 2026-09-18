// 浏览器录音 → 16kHz 单声道 16-bit WAV（whisper 可直接识别，无需 ffmpeg）
const RATE = 16000;

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([buf], { type: 'audio/wav' });
}

/** 开始录音，返回 { stop(): Promise<Blob>, cancel(), seconds() } */
export async function startRecording({ keepSpeech = false } = {}) {
  if (!keepSpeech) window.speechSynthesis?.cancel(); // 录音时停止朗读，避免录进 AI 的声音（影子跟读除外）
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext({ sampleRate: RATE });
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(proc); proc.connect(ctx.destination);
  const t0 = Date.now();
  const close = () => { proc.disconnect(); src.disconnect(); stream.getTracks().forEach((t) => t.stop()); ctx.close(); };
  return {
    seconds: () => (Date.now() - t0) / 1000,
    cancel: close,
    stop: async () => {
      close();
      const len = chunks.reduce((n, c) => n + c.length, 0);
      const all = new Float32Array(len);
      let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
      return encodeWav(all, ctx.sampleRate);
    },
  };
}

/** 上传识别，返回 { id, text, words } */
export async function transcribe(blob) {
  const res = await fetch('/api/asr', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `识别失败 ${res.status}`);
  return data;
}
