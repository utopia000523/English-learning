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
export function speak(text, { voice = '', rate = 1 } = {}) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = pickVoice(voice) || null;
    u.lang = u.voice?.lang || 'en-US';
    u.rate = rate;
    u.onend = u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}
