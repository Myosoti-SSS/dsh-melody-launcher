import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  Boxes,
  CircleAlert,
  CircleCheck,
  Download,
  ExternalLink,
  Folder,
  FolderGit2,
  GripVertical,
  Link2,
  LoaderCircle,
  PackageCheck,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { PageHeading } from '../components/PageHeading'
import { pluginInitial } from '../lib/format'
import { movePackage, movePackageTo } from '../lib/profile-order'
import type { InstalledApplicationAddon, InstalledPreset, InstalledSkill, ManagedPlugin, PluginTrialResult, ProfileState } from '../types'

/** 插件加载顺序页：列表、排序、启停与详情。 */

interface PluginsViewProps {
  profile: ProfileState
  profileName: string
  installedSkills: InstalledSkill[]
  installedApplications: InstalledApplicationAddon[]
  installedPresets: InstalledPreset[]
  pluginTrials: Record<string, PluginTrialResult>
  selected: ManagedPlugin | null
  busy: string | null
  onSelect: (plugin: ManagedPlugin) => void
  onToggle: (plugin: ManagedPlugin, enabled: boolean) => void
  onToggleSkill: (skill: InstalledSkill, enabled: boolean) => void
  onToggleApplication: (application: InstalledApplicationAddon, enabled: boolean) => void
  onUninstallApplication: (application: InstalledApplicationAddon) => void
  onTogglePreset: (preset: InstalledPreset, enabled: boolean) => void
  onReorder: (names: string[]) => void
  onRefresh: () => void
  onBrowse: () => void
  onOpenPath: (path: string) => void
  onOpenRepository: (url: string) => void
  onUninstall: (plugin: ManagedPlugin) => void
  onTrialPlugin: (packageName: string, profileName: string) => void
  onAdaptPlugin: (packageName: string, profileName: string) => void
  aiActive: boolean
  aiSubject: string | null
}

export function PluginsView({
  profile,
  profileName,
  installedSkills,
  installedApplications,
  installedPresets,
  pluginTrials,
  selected,
  busy,
  onSelect,
  onToggle,
  onToggleSkill,
  onToggleApplication,
  onUninstallApplication,
  onTogglePreset,
  onReorder,
  onRefresh,
  onBrowse,
  onOpenPath,
  onOpenRepository,
  onUninstall,
  onTrialPlugin,
  onAdaptPlugin,
  aiActive,
  aiSubject,
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
        description="Plugin 按顺序加载，Skill 独立启停；应用加载项在下方单独管理，不计入 Web Profile。"
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
                  busy={isComponentBusy(busy, plugin.repositoryFullName, plugin.packageName)}
                  linked={installedApplications.some(application => sameRepository(application.repository, plugin.repositoryFullName))}
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
                  busy={isComponentBusy(busy, plugin.repositoryFullName, plugin.packageName)}
                  linked={installedApplications.some(application => sameRepository(application.repository, plugin.repositoryFullName))}
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
              <div className="secondary-management-column">
                <SkillList skills={installedSkills.filter(skill => visibleSkill(skill, filter))} busy={busy} onToggle={onToggleSkill} />
                <PresetList presets={installedPresets.filter(preset => visiblePreset(preset, filter))} busy={busy} onToggle={onTogglePreset} />
              </div>
            </div>
          </section>
          <PluginDetails
            plugin={selected}
            profileName={profileName}
            trial={selected ? pluginTrials[`${profileName}:${selected.packageName}`] : undefined}
            busy={Boolean(selected && busy === `plugin-trial:${selected.packageName}`)}
            aiActive={aiActive}
            adapting={Boolean(selected && aiActive && aiSubject === selected.packageName)}
            onOpenRepository={onOpenRepository}
            onUninstall={onUninstall}
            onTrialPlugin={onTrialPlugin}
            onAdaptPlugin={onAdaptPlugin}
          />
        </div>
      )}

      <section className="application-addon-panel" aria-label="应用加载项">
        <div className="application-addon-heading">
          <div>
            <span><AppWindow size={15} />应用加载项</span>
            <p>独立应用宿主与伴随工具；不参与 Plugin 加载顺序。标记“协同”的项目会与同仓库 Plugin 同步启停。</p>
          </div>
          <small>{installedApplications.length} 个已安装</small>
        </div>
        <ApplicationList
          applications={installedApplications.filter(application => visibleApplication(application, filter))}
          plugins={profile.plugins}
          busy={busy}
          onToggle={onToggleApplication}
          onUninstall={onUninstallApplication}
        />
      </section>
    </div>
  )
}

function visibleSkill(skill: InstalledSkill, filter: string): boolean {
  return !filter || `${skill.name} ${skill.description}`.toLowerCase().includes(filter.toLowerCase())
}

function visibleApplication(application: InstalledApplicationAddon, filter: string): boolean {
  return !filter || `${application.name} ${application.packageName} ${application.description}`.toLowerCase().includes(filter.toLowerCase())
}

function ApplicationList({ applications, plugins, busy, onToggle, onUninstall }: {
  applications: InstalledApplicationAddon[]
  plugins: ManagedPlugin[]
  busy: string | null
  onToggle: (application: InstalledApplicationAddon, enabled: boolean) => void
  onUninstall: (application: InstalledApplicationAddon) => void
}) {
  return (
    <div className="application-management-column">
      {applications.length === 0 ? (
        <div className="skill-empty">尚未安装应用加载项</div>
      ) : (
        <div className="application-rows">
          {applications.map(application => {
            const linked = plugins.some(plugin => sameRepository(plugin.repositoryFullName, application.repository))
            const applicationBusy = isComponentBusy(busy, application.repository, `application:${application.id}`)
            return (
              <div className={`application-row ${application.enabled ? '' : 'disabled'}`} key={application.id}>
                <div className="skill-identity">
                  <div className="skill-glyph application-icon"><AppWindow size={15} /></div>
                  <div>
                    <strong>{application.name}{linked && <span className="linked-component-badge"><Link2 size={10} />协同</span>}</strong>
                    <span>{application.launchMode === 'runtime-replacement' ? '替代 Web 启动' : application.launchMode === 'after-runtime' ? '启动后伴随运行' : '独立应用'} · {application.version}</span>
                  </div>
                </div>
                <div className="application-row-actions">
                  <label className="switch" title={application.enabled ? '停用应用加载项' : '启用应用加载项'}>
                    <input
                      type="checkbox"
                      checked={application.enabled}
                      disabled={applicationBusy}
                      onChange={event => onToggle(application, event.target.checked)}
                      aria-label={`${application.enabled ? '停用' : '启用'} ${application.name}`}
                    />
                    <span>{applicationBusy && <LoaderCircle className="spin" size={11} />}</span>
                  </label>
                  <button
                    type="button"
                    className="application-remove-button"
                    disabled={busy === `application-remove:${application.id}`}
                    onClick={() => onUninstall(application)}
                    title={`卸载 ${application.name}`}
                    aria-label={`卸载 ${application.name}`}
                  >
                    {busy === `application-remove:${application.id}` ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function sameRepository(left?: string, right?: string): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase())
}

function isComponentBusy(busy: string | null, repository: string | undefined, fallback: string): boolean {
  return busy === fallback || Boolean(repository && busy === `component:${repository.toLowerCase()}`)
}

function visiblePreset(preset: InstalledPreset, filter: string): boolean {
  return !filter || preset.name.toLowerCase().includes(filter.toLowerCase())
}

/** Agent 预设列：与 Skill 相同的开关机制（目录在 .agent-presets/.disabled 下时停用）。 */
function PresetList({ presets, busy, onToggle }: {
  presets: InstalledPreset[]
  busy: string | null
  onToggle: (preset: InstalledPreset, enabled: boolean) => void
}) {
  return (
    <div className="skill-management-column preset-management-column">
      <div className="skill-column-heading"><span><Boxes size={14} />预设</span><small>{presets.length} 个已安装</small></div>
      {presets.length === 0 ? (
        <div className="skill-empty">尚未安装预设</div>
      ) : (
        <div className="skill-rows">
          {presets.map(preset => (
            <div className={`skill-row ${preset.enabled ? '' : 'disabled'}`} key={preset.name}>
              <div className="skill-identity">
                <div className="skill-glyph preset-glyph"><Boxes size={15} /></div>
                <div><strong>{preset.name}</strong><span>{preset.enabled ? '已启用' : '已停用'}</span></div>
              </div>
              <label className="switch" title={preset.enabled ? '停用预设' : '启用预设'}>
                <input
                  type="checkbox"
                  checked={preset.enabled}
                  disabled={busy === `preset:${preset.name}`}
                  onChange={event => onToggle(preset, event.target.checked)}
                  aria-label={`${preset.enabled ? '停用' : '启用'} 预设 ${preset.name}`}
                />
                <span>{busy === `preset:${preset.name}` && <LoaderCircle className="spin" size={11} />}</span>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  )
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

function PluginRow({ plugin, selected, busy, linked, dragging, canMoveUp, canMoveDown, onSelect, onToggle, onMove, onDragStart, onDrop }: {
  plugin: ManagedPlugin
  selected: boolean
  busy: boolean
  linked: boolean
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
        <div><strong>{plugin.displayName}{linked && <span className="linked-component-badge"><Link2 size={10} />协同</span>}</strong><span>{plugin.packageName}</span></div>
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

function PluginDetails({ plugin, profileName, trial, busy, aiActive, adapting, onOpenRepository, onUninstall, onTrialPlugin, onAdaptPlugin }: {
  plugin: ManagedPlugin | null
  profileName: string
  trial?: PluginTrialResult
  busy: boolean
  aiActive: boolean
  adapting: boolean
  onOpenRepository: (url: string) => void
  onUninstall: (plugin: ManagedPlugin) => void
  onTrialPlugin: (packageName: string, profileName: string) => void
  onAdaptPlugin: (packageName: string, profileName: string) => void
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
        {!plugin.builtin && (
          <div className="detail-trial-actions">
            <button
              type="button"
              className={`secondary-button full trial-button ${trial?.phase ?? ''}`}
              disabled={busy || aiActive || trial?.phase === 'running'}
              onClick={() => onTrialPlugin(plugin.packageName, profileName)}
              title={trial?.message ?? '只加载 DSH Web 核心与当前插件进行隔离试运行'}
            >
              {busy || trial?.phase === 'running'
                ? <LoaderCircle className="spin" size={16} />
                : trial?.phase === 'passed'
                  ? <CircleCheck size={16} />
                  : trial?.phase === 'failed'
                    ? <CircleAlert size={16} />
                    : <Play size={16} />}
              {trial?.phase === 'passed' ? '再次试运行' : trial?.phase === 'failed' ? '重新试运行' : trial?.phase === 'running' ? '试运行中' : '试运行'}
            </button>
            {trial?.phase === 'failed' && (
              <button
                type="button"
                className="secondary-button accent full"
                disabled={aiActive}
                onClick={() => onAdaptPlugin(plugin.packageName, profileName)}
              >
                {adapting ? <LoaderCircle className="spin" size={16} /> : <Wrench size={16} />}
                DSH 安装适配
              </button>
            )}
          </div>
        )}
        {plugin.repository && <button type="button" className="secondary-button full" onClick={() => onOpenRepository(plugin.repository!)}><FolderGit2 size={16} />查看仓库<ExternalLink size={14} /></button>}
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
