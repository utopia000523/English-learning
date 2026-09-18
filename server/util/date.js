// 日期统一用本地时区的 YYYY-MM-DD 字符串
export const todayStr = (d = new Date()) => d.toLocaleDateString('sv-SE');
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return todayStr(d);
}
export function diffDays(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
