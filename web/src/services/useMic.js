// 录音 Hook：start() 开始，stop() 结束并返回 { blob, url }，seconds 为已录秒数
import { useEffect, useRef, useState } from 'react';
import { startRecording } from './recorder.js';

export function useMic({ maxSeconds = 90, onAutoStop } = {}) {
  const ref = useRef(null);
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!recording) return undefined;
    const t = setInterval(() => {
      const s = ref.current?.seconds() || 0;
      setSeconds(s);
      if (s >= maxSeconds) onAutoStop?.();
    }, 200);
    return () => clearInterval(t);
  }, [recording, maxSeconds, onAutoStop]);
  useEffect(() => () => ref.current?.cancel(), []);
  return {
    recording, seconds,
    async start() {
      ref.current = await startRecording({ keepSpeech: true });
      setSeconds(0); setRecording(true);
    },
    async stop() {
      const r = ref.current; ref.current = null; setRecording(false);
      if (!r) return null;
      const blob = await r.stop();
      return { blob, url: URL.createObjectURL(blob), seconds: r.seconds() };
    },
    cancel() { ref.current?.cancel(); ref.current = null; setRecording(false); },
  };
}
