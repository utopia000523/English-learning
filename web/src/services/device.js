// 是否手机屏幕（与 styles.css 里的 @media (max-width:760px) 一致）
export const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
