import {
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  CircleAlert,
  Download,
  ExternalLink,
  Folder,
  Github,
  GripVertical,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { PageHeading } from '../components/PageHeading'
import { pluginInitial } from '../lib/format'
import { movePackage, movePackageTo } from '../lib/profile-order'
import type { InstalledSkill, ManagedPlugin, ProfileState } from '../types'

/** 插件加载顺序页：列表、排序、启停与详情。 */

interface PluginsViewProps {
  profile: ProfileState
  installedSkills: InstalledSkill[]
  selected: ManagedPlugin | null
  busy: string | null
  onSelect: (plugin: ManagedPlugin) => void
  onToggle: (plugin: ManagedPlugin, enabled: boolean) => void
  onToggleSkill: (skill: InstalledSkill, enabled: boolean) => void
  onReorder: (names: string[]) => void
  onRefresh: () => void
  onBrowse: () => void
  onOpenPath: (path: string) => void
  onOpenRepository: (url: string) => void
  onUninstall: (plugin: ManagedPlugin) => void
}

export function PluginsView({
  profile,
  installedSkills,
  selected,
  busy,
  onSelect,
  onToggle,
  onToggleSkill,
  onReorder,
  onRefresh,
  onBrowse,
  onOpenPath,
  onOpenRepository,
  onUninstall,
}: PluginsViewProps) {
  const [filter, setFilter] = useState('')
  const [dragged, setDragged] = useState<string | null>(null)

  const active = profile.plugins.filter(plugin => plugin.enabled)
  const inactive = profile.plugins.filter(plugin => !plugin.enabled)
  const activeNames = active.map(plugin => plugin.packageName)
  const visible = (plugin: ManagedPlugin) =>
    !filter || `${plugin.displayName} ${plugin.packageName}`.toLowerCase().includes(filter.toLowerCase())

  const move = (packageName: string, direction: -1 | 1) => {
    const names = movePackage(activeNames, packageName, direction)
    if (names) onReorder(names)
  }

  const dropAt = (targetName: string) => {
    const names = dragged ? movePackageTo(activeNames, dragged, targetName) : null
    setDragged(null)
    if (names) onReorder(names)
  }

  return (
    <div className="page plugins-page">
      <PageHeading
        eyebrow="WEB PROFILE"
        title="插件加载顺序"
        description="上方先加载，下方可覆盖前序配置。停用插件不会从本机删除。"
        actions={(
          <>
            <button className="secondary-button" type="button" onClick={onRefresh}><RefreshCw size={17} />刷新</button>
            <button className="secondary-button accent" type="button" onClick={onBrowse}><Download size={17} />获取插件</button>
          </>
        )}
      />

      <div className="stats-strip" aria-label="配置概况">
        <div><strong>{profile.activeBundles.length}</strong><span>已激活</span></div>
        <div><strong>{profile.disabledCount}</strong><span>已停用</span></div>
        <div><strong>{profile.dependencyCount}</strong><span>第三方依赖</span></div>
        <button type="button" onClick={() => onOpenPath(profile.profileDir)} title="在资源管理器中打开配置目录">
          <Folder size={16} /><span className="path-clip">{profile.profileDir}</span><ExternalLink size={14} />
        </button>
      </div>

      {!profile.initialized ? (
        <EmptyProfile onBrowse={onBrowse} />
      ) : (
        <div className="plugin-layout">
          <section className="plugin-list-panel" aria-label="插件列表">
            <div className="list-toolbar">
              <label className="search-field compact">
                <Search size={16} />
                <input value={filter} onChange={event => setFilter(event.target.value)} placeholder="筛选已安装插件" />
                {filter && <button type="button" onClick={() => setFilter('')} aria-label="清除筛选"><X size={15} /></button>}
              </label>
              <span>{active.length} 个加载层</span>
            </div>
            <div className="plugin-management-grid">
              <div className="plugin-management-column">
            <div className="column-headings" aria-hidden="true">
              <span>优先级</span><span>插件</span><span>版本</span><span>状态</span><span />
            </div>
            <div className="plugin-rows">
              {active.filter(visible).map((plugin, index) => (
                <PluginRow
                  key={plugin.packageName}
                  plugin={plugin}
                  selected={selected?.packageName === plugin.packageName}
                  busy={busy === plugin.packageName}
                  dragging={dragged === plugin.packageName}
                  canMoveUp={index > 0}
                  canMoveDown={index < active.length - 1}
                  onSelect={() => onSelect(plugin)}
                  onToggle={enabled => onToggle(plugin, enabled)}
                  onMove={moveDirection => move(plugin.packageName, moveDirection)}
                  onDragStart={() => setDragged(plugin.packageName)}
                  onDrop={() => dropAt(plugin.packageName)}
                />
              ))}
              {inactive.length > 0 && <div className="disabled-divider"><span>已停用</span><i /></div>}
              {inactive.filter(visible).map(plugin => (
                <PluginRow
                  key={plugin.packageName}
                  plugin={plugin}
                  selected={selected?.packageName === plugin.packageName}
                  busy={busy === plugin.packageName}
                  dragging={false}
                  canMoveUp={false}
                  canMoveDown={false}
                  onSelect={() => onSelect(plugin)}
                  onToggle={enabled => onToggle(plugin, enabled)}
                  onMove={() => undefined}
                  onDragStart={() => undefined}
                  onDrop={() => undefined}
                />
              ))}
            </div>
              </div>
              <SkillList skills={installedSkills.filter(skill => visibleSkill(skill, filter))} busy={busy} onToggle={onToggleSkill} />
            </div>
          </section>
          <PluginDetails
            plugin={selected}
            onOpenRepository={onOpenRepository}
            onUninstall={onUninstall}
          />
        </div>
      )}
    </div>
  )
}

function visibleSkill(skill: InstalledSkill, filter: string): boolean {
  return !filter || `${skill.name} ${skill.description}`.toLowerCase().includes(filter.toLowerCase())
}

function SkillList({ skills, busy, onToggle }: {
  skills: InstalledSkill[]
  busy: string | null
  onToggle: (skill: InstalledSkill, enabled: boolean) => void
}) {
  return (
    <div className="skill-management-column">
      <div className="skill-column-heading"><span><BookOpenCheck size={14} />Skill</span><small>{skills.length} 个已安装</small></div>
      {skills.length === 0 ? (
        <div className="skill-empty">尚未安装 Skill</div>
      ) : (
        <div className="skill-rows">
          {skills.map(skill => (
            <div className={`skill-row ${skill.enabled ? '' : 'disabled'}`} key={skill.name}>
              <div className="skill-identity">
                <div className="skill-glyph"><BookOpenCheck size={15} /></div>
                <div><strong>{skill.name}</strong><span>{skill.description}</span></div>
              </div>
              <label className="switch" title={skill.enabled ? '停用 Skill' : '启用 Skill'}>
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  disabled={busy === `skill:${skill.name}`}
                  onChange={event => onToggle(skill, event.target.checked)}
                  aria-label={`${skill.enabled ? '停用' : '启用'} Skill ${skill.name}`}
                />
                <span>{busy === `skill:${skill.name}` && <LoaderCircle className="spin" size={11} />}</span>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PluginRow({ plugin, selected, busy, dragging, canMoveUp, canMoveDown, onSelect, onToggle, onMove, onDragStart, onDrop }: {
  plugin: ManagedPlugin
  selected: boolean
  busy: boolean
  dragging: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onSelect: () => void
  onToggle: (enabled: boolean) => void
  onMove: (direction: -1 | 1) => void
  onDragStart: () => void
  onDrop: () => void
}) {
  return (
    <div
      className={`plugin-row ${selected ? 'selected' : ''} ${plugin.enabled ? '' : 'disabled'} ${dragging ? 'dragging' : ''}`}
      draggable={plugin.enabled}
      onDragStart={event => {
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); onDrop() }}
      onClick={onSelect}
    >
      <div className="priority-cell">
        {plugin.enabled ? <><GripVertical size={15} /><strong>{String(plugin.order).padStart(2, '0')}</strong></> : <span>—</span>}
      </div>
      <div className="plugin-identity">
        <div className={`plugin-glyph glyph-${plugin.packageName.length % 4}`}>{pluginInitial(plugin)}</div>
        <div><strong>{plugin.displayName}</strong><span>{plugin.packageName}</span></div>
      </div>
      <span className="plugin-version">{plugin.version}</span>
      <div className="state-cell">
        {!plugin.compatible && <span className="compatibility-warning" title="未检测到 dsh.bundle 声明"><CircleAlert size={16} /></span>}
        <label className={`switch ${plugin.locked ? 'locked' : ''}`} title={plugin.locked ? '核心组合层始终启用' : plugin.enabled ? '停用插件' : '启用插件'} onClick={event => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={plugin.enabled}
            disabled={plugin.locked || busy || !plugin.compatible}
            onChange={event => onToggle(event.target.checked)}
            aria-label={`${plugin.enabled ? '停用' : '启用'} ${plugin.displayName}`}
          />
          <span>{busy && <LoaderCircle className="spin" size={11} />}</span>
        </label>
      </div>
      <div className="row-actions" onClick={event => event.stopPropagation()}>
        <button type="button" disabled={!canMoveUp} onClick={() => onMove(-1)} title="向上移动" aria-label={`向上移动 ${plugin.displayName}`}><ArrowUp size={15} /></button>
        <button type="button" disabled={!canMoveDown} onClick={() => onMove(1)} title="向下移动" aria-label={`向下移动 ${plugin.displayName}`}><ArrowDown size={15} /></button>
      </div>
    </div>
  )
}

function PluginDetails({ plugin, onOpenRepository, onUninstall }: {
  plugin: ManagedPlugin | null
  onOpenRepository: (url: string) => void
  onUninstall: (plugin: ManagedPlugin) => void
}) {
  if (!plugin) return <aside className="plugin-details empty">选择一个插件查看详情</aside>
  return (
    <aside className="plugin-details">
      <div className="detail-topline">
        <div className={`plugin-glyph large glyph-${plugin.packageName.length % 4}`}>{pluginInitial(plugin)}</div>
        <div className={`detail-state ${plugin.enabled ? 'active' : ''}`}><span />{plugin.enabled ? '已激活' : '已停用'}</div>
      </div>
      <h2>{plugin.displayName}</h2>
      <p className="package-name">{plugin.packageName}</p>
      <p className="plugin-description">{plugin.description}</p>
      <dl>
        <div><dt>加载优先级</dt><dd>{plugin.order ? `#${String(plugin.order).padStart(2, '0')}` : '不加载'}</dd></div>
        <div><dt>版本</dt><dd>{plugin.version}</dd></div>
        <div><dt>来源</dt><dd>{plugin.builtin ? 'DSH 内置' : 'Profile 依赖'}</dd></div>
        <div><dt>兼容性</dt><dd className={plugin.compatible ? 'good' : 'warning'}>{plugin.compatible ? 'Bundle 已识别' : '未检测到 Bundle'}</dd></div>
      </dl>
      <div className="detail-note">
        <SlidersHorizontal size={16} />
        <p>{plugin.enabled ? '本层会按当前优先级参与下一次 DSH 启动。' : '插件文件仍保留在本机，可随时重新启用。'}</p>
      </div>
      <div className="detail-actions">
        {plugin.repository && <button type="button" className="secondary-button full" onClick={() => onOpenRepository(plugin.repository!)}><Github size={16} />查看仓库<ExternalLink size={14} /></button>}
        {!plugin.builtin && <button type="button" className="danger-button full" onClick={() => onUninstall(plugin)}><Trash2 size={16} />从此配置卸载</button>}
      </div>
    </aside>
  )
}

function EmptyProfile({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><PackageCheck size={28} /></div>
      <h2>Web 配置尚未初始化</h2>
      <p>首次启动 DSH 或安装插件时，官方 CLI 会创建 profile。启动器随后会在这里显示真实的组合层。</p>
      <button type="button" className="primary-command" onClick={onBrowse}><Sparkles size={17} />浏览插件</button>
    </div>
  )
}
