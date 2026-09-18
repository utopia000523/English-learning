export default function Placeholder({ title, stage }) {
  return (
    <div className="narrow">
      <div className="head"><div><h1>{title}</h1></div></div>
      <div className="todo-note">此页面在阶段 {stage} 实现。界面参考 docs/prototype.html，需求见 docs/PRD.md。</div>
    </div>
  );
}
