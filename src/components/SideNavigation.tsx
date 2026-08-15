import { Box, Layers3, Sparkles, SquareTerminal } from 'lucide-react'
import type { ProfileState, RuntimeState, ViewName } from '../types'

/** 管理界面左侧导航与当前 Profile 摘要。 */

interface NavigationEntry {
  id: ViewName
  label: string
  icon: typeof Box
  count?: number
}

interface SideNavigationProps {
  view: ViewName
  profile: ProfileState
  runtime: RuntimeState
  profileName: string
  onChange: (view: ViewName) => void
}

export function SideNavigation({ view, profile, runtime, profileName, onChange }: SideNavigationProps) {
  const entries: NavigationEntry[] = [
    { id: 'plugins', label: '插件顺序', icon: Layers3, count: profile.plugins.length },
    { id: 'discover', label: '资源市场', icon: Sparkles },
    { id: 'runtime', label: '运行与日志', icon: SquareTerminal },
  ]

  return (
    <aside className="side-navigation">
      <nav aria-label="主导航">
        {entries.map(entry => {
          const Icon = entry.icon
          return (
            <button
              key={entry.id}
              type="button"
              className={view === entry.id ? 'active' : ''}
              aria-label={entry.label}
              title={entry.label}
              onClick={() => onChange(entry.id)}
            >
              <Icon size={18} />
              <span>{entry.label}</span>
              {entry.count !== undefined && <span className="nav-count">{entry.count}</span>}
            </button>
          )
        })}
      </nav>
      <div className="profile-summary">
        <div className="profile-icon"><Box size={17} /></div>
        <div className="profile-copy">
          <strong>{profileName}</strong>
          <span>{profile.initialized ? `${profile.activeBundles.length} 层已激活` : '等待初始化'}</span>
        </div>
        <span className={`mini-status ${runtime.running ? 'running' : ''}`} title={runtime.running ? 'DSH 正在运行' : 'DSH 未运行'} />
      </div>
    </aside>
  )
}
