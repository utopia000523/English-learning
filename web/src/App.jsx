import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { Icon } from './icons.jsx';
import Today from './pages/Today.jsx';
import Settings from './pages/Settings.jsx';
import Placeholder from './pages/Placeholder.jsx';
import Cards from './pages/Cards.jsx';
import { RoleplayList, RoleplayChat } from './pages/Roleplay.jsx';
import Shadow from './pages/Shadow.jsx';
import Mono from './pages/Mono.jsx';

// 导航结构与 docs/prototype.html 保持一致
const NAV = [
  { to: '/today', label: '今日', icon: Icon.home },
  { sep: '练习' },
  { to: '/roleplay', label: 'AI 对话', icon: Icon.chat },
  { to: '/cards', label: '表达卡', icon: Icon.card },
  { to: '/shadow', label: '跟读', icon: Icon.wave },
  { to: '/mono', label: '独白', icon: Icon.mic },
  { sep: '记录' },
  { to: '/plan', label: '学习计划', icon: Icon.cal, stage: 5 },
  { to: '/notes', label: '笔记本', icon: Icon.note, stage: 5 },
  { to: '/progress', label: '进度', icon: Icon.chart, stage: 5 },
  { sep: '' },
  { to: '/settings', label: '设置', icon: Icon.gear },
];

export default function App() {
  return (
    <div className="app">
      <aside className="side">
        <div className="brand">开口 90 天</div>
        <nav className="nav">
          {NAV.map((n, i) => n.sep !== undefined
            ? <div className="sep" key={i}>{n.sep}</div>
            : <NavLink key={n.to} to={n.to}>{n.icon}{n.label}</NavLink>)}
        </nav>
        <div className="side-foot"><div className="avatar">U</div><div style={{ flex: 1 }}>Utopia</div></div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<Today />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/cards" element={<Cards />} />
          <Route path="/shadow" element={<Shadow />} />
          <Route path="/mono" element={<Mono />} />
          <Route path="/roleplay" element={<RoleplayList />} />
          <Route path="/roleplay/:id" element={<RoleplayChat />} />
          {NAV.filter((n) => n.stage).map((n) => (
            <Route key={n.to} path={n.to} element={<Placeholder title={n.label} stage={n.stage} />} />
          ))}
        </Routes>
      </main>
    </div>
  );
}
