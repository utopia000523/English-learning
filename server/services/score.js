// 跟读 / 独白评分（纯本地计算）。阶段 4 实现
// align(referenceText, words) -> 逐词对齐结果：[{ word, status: 'ok'|'unsure'|'missed'|'wrong' }]
// fluency(words, durationSec) -> { wpm, longPauses, fillers }
export function align() {
  throw Object.assign(new Error('跟读评分将在阶段 4 实现'), { code: 'NOT_IMPLEMENTED' });
}
export function fluency() {
  throw Object.assign(new Error('流利度统计将在阶段 4 实现'), { code: 'NOT_IMPLEMENTED' });
}
