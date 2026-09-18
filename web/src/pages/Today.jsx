// 阶段 1：页面框架。阶段 5 接入每日随机课程（PRD 2.3）
export default function Today() {
  const h = new Date().getHours();
  const hello = h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好';
  return (
    <div className="narrow">
      <h1>{hello}，Utopia</h1>
      <p className="sub">90 天口语计划</p>
      <div className="sec">
        <div className="sec-t"><span>今日练习</span></div>
        <div className="todo-note">每日课程（热身 → 两个随机练习 → 收尾）在阶段 5 实现。现在可以先到「设置」检查本地服务是否就绪。</div>
      </div>
    </div>
  );
}
