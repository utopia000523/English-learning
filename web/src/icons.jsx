// 线性图标，与原型一致
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, viewBox: '0 0 24 24' };
export const Icon = {
  home: <svg {...P}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>,
  chat: <svg {...P}><path d="M4 5h16v11H9l-5 4z" /></svg>,
  card: <svg {...P}><rect x="3" y="6" width="14" height="13" rx="2" /><path d="M7 3h12a2 2 0 0 1 2 2v11" /></svg>,
  wave: <svg {...P}><path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 10v4" /></svg>,
  mic: <svg {...P}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>,
  cal: <svg {...P}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  note: <svg {...P}><path d="M6 3h9l4 4v14H6z" /><path d="M9 11h7M9 15h7" /></svg>,
  chart: <svg {...P}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  gear: <svg {...P}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>,
  back: <svg {...P} strokeWidth={1.8} width={15} height={15}><path d="M15 6l-6 6 6 6" /></svg>,
  plus: <svg {...P} strokeWidth={1.8} width={15} height={15}><path d="M12 5v14M5 12h14" /></svg>,
  play: <svg viewBox="0 0 24 24" fill="currentColor" width={15} height={15}><path d="M7 4l13 8-13 8z" /></svg>,
  shuffle: <svg {...P} width={14} height={14}><path d="M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3" /></svg>,
  speaker: <svg {...P}><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M16 9a4 4 0 0 1 0 6" /></svg>,
};
