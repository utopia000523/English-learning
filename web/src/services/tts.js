// 朗读：浏览器 Web Speech API，使用 macOS 系统英语声音（在浏览器端运行）
export function englishVoices() {
  return window.speechSynthesis?.getVoices().filter((v) => v.lang.startsWith('en')) ?? [];
}
export function voicesReady() {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve([]);
    const v = englishVoices();
    if (v.length) return resolve(v);
    window.speechSynthesis.onvoiceschanged = () => resolve(englishVoices());
    setTimeout(() => resolve(englishVoices()), 1500);
  });
}
function pickVoice(name) {
  const list = englishVoices();
  return list.find((v) => v.name === name)
    || list.find((v) => v.lang === 'en-US' && /Samantha|Ava|Allison/.test(v.name))
    || list.find((v) => v.lang === 'en-US') || list[0];
}
// 在线声音（如 Google 系列）需联网；无法使用时返回 { ok: false, online: true }，由页面提示
export function speak(text, { voice = '', rate = 1 } = {}) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve({ ok: false });
    const v = pickVoice(voice);
    const online = v ? !v.localService : false;
    if (online && !navigator.onLine) return resolve({ ok: false, online });
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v || null;
    u.lang = u.voice?.lang || 'en-US';
    u.rate = rate;
    // 兜底：个别情况下浏览器不触发 onend，按文本长度超时结束，避免流程卡住
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; clearTimeout(guard); resolve(r); } };
    const guard = setTimeout(() => finish({ ok: true, timeout: true }), 4000 + text.length * 120 / rate);
    u.onend = () => finish({ ok: true });
    u.onerror = (e) => finish({ ok: e.error === 'interrupted' || e.error === 'canceled', online });
    window.speechSynthesis.speak(u);
  });
}
