import { Box, GitFork, Layers3, Package, Sparkles, SquareTerminal } from 'lucide-react'
import type { PackStatus, ProfileState, RuntimeState, ViewName } from '../types'

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
  packs: PackStatus[]
  activePackId: string | null | undefined
  onPackChange: (packId: string) => void
  onChange: (view: ViewName) => void
}

export function SideNavigation({ view, profile, runtime, profileName, packs, activePackId, onPackChange, onChange }: SideNavigationProps) {
  const entries: NavigationEntry[] = [
    { id: 'plugins', label: '插件顺序', icon: Layers3, count: profile.plugins.length },
    { id: 'discover', label: '资源市场', icon: Sparkles },
    { id: 'packs', label: '整合包', icon: Package },
    { id: 'github', label: 'GitHub', icon: GitFork },
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
          {packs.length > 0 && (
            <select
              className="pack-switcher"
              aria-label="切换整合包"
              value={activePackId ?? ''}
              onChange={event => onPackChange(event.target.value)}
            >
              <option value="">默认配置</option>
              {packs.map(pack => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
            </select>
          )}
        </div>
        <span className={`mini-status ${runtime.running ? 'running' : ''}`} title={runtime.running ? 'DSH 正在运行' : 'DSH 未运行'} />
      </div>
    </aside>
  )
}
