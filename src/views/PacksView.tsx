import {
  Download,
  LoaderCircle,
  Package,
  PackagePlus,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeading } from '../components/PageHeading'
import { formatRelativeTime } from '../lib/format'
import type { InstalledPreset, ManagedPlugin, PackStatus, ProfileState } from '../types'

/**
 * 整合包管理页：列表、启停、导出、删除，右侧 inline 详情面板管理包内插件。
 * 流式创建/导入走 use-pack-install（App 挂载 PackInstallDialog），
 * 这里的一次性动作（启停/导出/删除/包内插件增删改）都委托给 store。
 */

export interface PacksViewProps {
  packs: PackStatus[]
  profile: ProfileState
  /** 当前正在忙碌的一次性动作标识（useAsyncAction.busy）。 */
  busy: string | null
  onRefresh: () => void
  onCreate: () => void
  onImport: () => void
  onActivate: (packId: string) => void
  onDeactivate: () => void
  onExport: (packId: string) => void
  onRemove: (packId: string) => void
  onAddPlugin: (packId: string, packageName: string) => void
  onAddPreset: (packId: string, presetName: string) => void
  onToggleItem: (packId: string, packageName: string, enabled: boolean) => void
  onTogglePreset: (packId: string, presetName: string, enabled: boolean) => void
  onRemoveItem: (packId: string, packageName: string) => void
  onRemovePreset: (packId: string, presetName: string) => void
  /** 当前已安装且带来源记录的 Agent 预设，供添加到包内。 */
  installedPresets: InstalledPreset[]
}

const SOURCE_LABEL: Record<PackStatus['source'], string> = {
  created: '自建',
  zip: '离线包',
  manifest: '清单包',
  raw: '扫描导入',
}

const STATE_LABEL: Record<PackStatus['state'], string> = {
  complete: '完整',
  partial: '部分成功',
  failed: '失败',
}

export function PacksView({
  packs,
  profile,
  busy,
  onRefresh,
  onCreate,
  onImport,
  onActivate,
  onDeactivate,
  onExport,
  onRemove,
  onAddPlugin,
  onAddPreset,
  onToggleItem,
  onTogglePreset,
  onRemoveItem,
  onRemovePreset,
  installedPresets,
}: PacksViewProps) {
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null)
  const [confirmingRemoval, setConfirmingRemoval] = useState<PackStatus | null>(null)

  const selectedPack = useMemo(() => {
    if (selectedPackId) {
      const found = packs.find(pack => pack.id === selectedPackId)
      if (found) return found
    }
    return packs.find(pack => pack.enabled) ?? packs[0] ?? null
  }, [packs, selectedPackId])

  const activeCount = packs.filter(pack => pack.enabled).length
  const totalPlugins = packs.reduce((sum, pack) => sum + pack.plugins.length, 0)
  const refreshing = busy === 'pack-refresh'

  const toggleSelect = (packId: string) => {
    setSelectedPackId(current => current === packId ? null : packId)
  }

  return (
    <div className="page packs-page">
      <PageHeading
        eyebrow="PACKS"
        title="整合包"
        description="把一组插件组合成可复用的配置，可自建、从 zip/清单导入，也能导出分享给他人。启用即切换当前 Profile。"
        actions={(
          <>
            <button type="button" className="secondary-button" onClick={onRefresh} disabled={busy !== null}>
              {refreshing ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}刷新
            </button>
            <button type="button" className="secondary-button accent" onClick={onCreate}><PackagePlus size={17} />创建整合包</button>
            <button type="button" className="primary-command" onClick={onImport}><Download size={17} />导入整合包</button>
          </>
        )}
      />

      <div className="stats-strip packs-stats" aria-label="整合包概况">
        <div><strong>{packs.length}</strong><span>整合包</span></div>
        <div><strong>{activeCount}</strong><span>使用中</span></div>
        <div><strong>{totalPlugins}</strong><span>累计插件</span></div>
      </div>

      {packs.length === 0 ? (
        <EmptyPacks onCreate={onCreate} onImport={onImport} />
      ) : (
        <div className="packs-layout">
          <section className="packs-list-panel" aria-label="整合包列表">
            {packs.map(pack => (
              <PackRow
                key={pack.id}
                pack={pack}
                selected={selectedPack?.id === pack.id}
                busy={busy}
                onSelect={() => toggleSelect(pack.id)}
                onActivate={() => onActivate(pack.id)}
                onDeactivate={onDeactivate}
                onExport={() => onExport(pack.id)}
                onRemove={() => setConfirmingRemoval(pack)}
              />
            ))}
          </section>
          <PackDetails
            key={selectedPack?.id ?? 'none'}
            pack={selectedPack}
            profile={profile}
            busy={busy}
            onToggleItem={(packageName, enabled) => onToggleItem(selectedPack!.id, packageName, enabled)}
            onRemoveItem={packageName => onRemoveItem(selectedPack!.id, packageName)}
            onAddPlugins={packageNames => {
              for (const packageName of packageNames) onAddPlugin(selectedPack!.id, packageName)
            }}
            installedPresets={installedPresets}
            onAddPresets={presetNames => {
              for (const presetName of presetNames) onAddPreset(selectedPack!.id, presetName)
            }}
            onTogglePreset={(presetName, enabled) => onTogglePreset(selectedPack!.id, presetName, enabled)}
            onRemovePreset={presetName => onRemovePreset(selectedPack!.id, presetName)}
          />
        </div>
      )}

      {confirmingRemoval && (
        <RemovePackDialog
          pack={confirmingRemoval}
          busy={busy === `pack-remove:${confirmingRemoval.id}`}
          onCancel={() => setConfirmingRemoval(null)}
          onConfirm={() => {
            const pack = confirmingRemoval
            setConfirmingRemoval(null)
            onRemove(pack.id)
          }}
        />
      )}

      <style>{packsStyle}</style>
    </div>
  )
}

function EmptyPacks({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Package size={28} /></div>
      <h2>还没有整合包</h2>
      <p>整合包把一组插件组合成可复用的配置，可以自建、从 zip/清单导入，也能导出分享。启用整合包会切换当前 Profile。</p>
      <div className="empty-state-actions">
        <button type="button" className="primary-command" onClick={onCreate}><PackagePlus size={17} />创建整合包</button>
        <button type="button" className="secondary-button accent" onClick={onImport}><Download size={17} />导入整合包</button>
      </div>
    </div>
  )
}

function PackRow({ pack, selected, busy, onSelect, onActivate, onDeactivate, onExport, onRemove }: {
  pack: PackStatus
  selected: boolean
  busy: string | null
  onSelect: () => void
  onActivate: () => void
  onDeactivate: () => void
  onExport: () => void
  onRemove: () => void
}) {
  const activating = busy === `pack-activate:${pack.id}`
  const deactivating = busy === 'pack-deactivate'
  const removing = busy === `pack-remove:${pack.id}`
  const exporting = busy === `pack-export:${pack.id}`
  const rowDisabled = busy !== null

  return (
    <article className={`pack-row ${selected ? 'selected' : ''} ${pack.enabled ? 'active' : ''}`}>
      <div className="pack-row-main" onClick={onSelect}>
        <div className={`pack-glyph ${pack.source}`}>{pack.name.slice(0, 2).toUpperCase()}</div>
        <div className="pack-row-copy">
          <div className="pack-title-line">
            <strong>{pack.name}</strong>
            <span className="pack-source-badge">{SOURCE_LABEL[pack.source]}</span>
            <span className={`pack-state-badge ${pack.state}`}>{STATE_LABEL[pack.state]}</span>
            {pack.enabled && <span className="pack-active-badge">使用中</span>}
          </div>
          <p>{pack.description || '（无描述）'}</p>
          <small>v{pack.version} · {pack.plugins.length} 个插件{pack.presets?.length ? ` · ${pack.presets.length} 个预设` : ''} · 更新于 {formatRelativeTime(pack.updatedAt)}</small>
        </div>
      </div>
      <div className="pack-row-actions" onClick={event => event.stopPropagation()}>
        {pack.enabled ? (
          <button type="button" className="secondary-button" disabled={rowDisabled || deactivating} onClick={onDeactivate}>
            {deactivating ? <LoaderCircle className="spin" size={15} /> : null}停用
          </button>
        ) : (
          <button type="button" className="install-button" disabled={rowDisabled} onClick={onActivate}>
            {activating ? <LoaderCircle className="spin" size={15} /> : null}启用
          </button>
        )}
        <button type="button" className="secondary-button" disabled={rowDisabled} onClick={onExport}>
          {exporting ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}导出
        </button>
        <button type="button" className={`secondary-button ${selected ? 'accent' : ''}`} disabled={rowDisabled} onClick={onSelect}>
          详情
        </button>
        <button type="button" className="danger-button" disabled={rowDisabled} onClick={onRemove}>
          {removing ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}删除
        </button>
      </div>
    </article>
  )
}

function PackDetails({ pack, profile, busy, onToggleItem, onRemoveItem, onAddPlugins, installedPresets, onAddPresets, onTogglePreset, onRemovePreset }: {
  pack: PackStatus | null
  profile: ProfileState
  busy: string | null
  onToggleItem: (packageName: string, enabled: boolean) => void
  onRemoveItem: (packageName: string) => void
  onAddPlugins: (packageNames: string[]) => void
  installedPresets: InstalledPreset[]
  onAddPresets: (presetNames: string[]) => void
  onTogglePreset: (presetName: string, enabled: boolean) => void
  onRemovePreset: (presetName: string) => void
}) {
  const [addingOpen, setAddingOpen] = useState(false)
  const [addingPresetsOpen, setAddingPresetsOpen] = useState(false)

  if (!pack) {
    return <aside className="pack-details empty">选择一个整合包查看详情</aside>
  }

  const candidates = profile.plugins.filter(plugin => !pack.plugins.some(item => item.packageName === plugin.packageName))
  const presetCandidates = installedPresets.filter(preset =>
    !pack.presets?.some(item => item.name === preset.name)
    && Boolean(preset.repository && preset.sourcePath && preset.revision)
  )

  return (
    <aside className="pack-details">
      <div className="pack-details-head">
        <div>
          <h2>{pack.name}</h2>
          <p>{pack.description || '（无描述）'}</p>
        </div>
        {pack.enabled && <span className="pack-active-badge">使用中</span>}
      </div>
      <dl className="pack-details-meta">
        <div><dt>版本</dt><dd>{pack.version}</dd></div>
        <div><dt>来源</dt><dd>{SOURCE_LABEL[pack.source]}</dd></div>
        <div><dt>状态</dt><dd className={pack.state}>{STATE_LABEL[pack.state]}</dd></div>
      </dl>
      {pack.failures && pack.failures.length > 0 && (
        <div className="pack-details-failures">
          <div className="pack-details-failures-head"><span>失败项（{pack.failures.length}）</span></div>
          <div className="pack-failure-items">
            {pack.failures.map(failure => (
              <div className="pack-failure-row" key={failure.packageName}>
                <code>{failure.packageName}</code>
                <span>{failure.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="pack-details-plugins">
        <div className="pack-details-plugins-head">
          <span>包含插件（{pack.plugins.length}）</span>
          <button
            type="button"
            className="install-button"
            disabled={busy !== null || candidates.length === 0}
            onClick={() => setAddingOpen(true)}
            title={candidates.length === 0 ? '当前 Profile 没有可添加的新插件' : '从当前 Profile 选择插件加入'}
          >
            <Plus size={14} />添加插件
          </button>
        </div>
        {pack.plugins.length === 0 ? (
          <div className="pack-details-empty">整合包里还没有插件。</div>
        ) : (
          <div className="pack-detail-items">
            {pack.plugins.map(item => {
              const toggling = busy === `pack-toggle:${pack.id}:${item.packageName}`
              const removing = busy === `pack-remove-item:${pack.id}:${item.packageName}`
              return (
                <div className={`pack-detail-item ${item.enabled ? '' : 'disabled'}`} key={item.packageName}>
                  <code>{item.packageName}</code>
                  <label className="switch" title={item.enabled ? '停用该插件' : '启用该插件'}>
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      disabled={busy !== null}
                      onChange={event => onToggleItem(item.packageName, event.target.checked)}
                      aria-label={`${item.enabled ? '停用' : '启用'} ${item.packageName}`}
                    />
                    <span>{toggling && <LoaderCircle className="spin" size={11} />}</span>
                  </label>
                  <button
                    type="button"
                    className="pack-detail-remove"
                    disabled={busy !== null}
                    onClick={() => onRemoveItem(item.packageName)}
                    title="从整合包移除"
                    aria-label={`从整合包移除 ${item.packageName}`}
                  >
                    {removing ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="pack-details-plugins">
        <div className="pack-details-plugins-head">
          <span>包含预设（{pack.presets?.length ?? 0}）</span>
          <button
            type="button"
            className="install-button"
            disabled={busy !== null || presetCandidates.length === 0}
            onClick={() => setAddingPresetsOpen(true)}
            title={presetCandidates.length === 0 ? '没有可添加的预设（需先安装并留有来源记录）' : '从已安装预设中选择加入'}
          >
            <Plus size={14} />添加预设
          </button>
        </div>
        {(pack.presets?.length ?? 0) === 0 ? (
          <div className="pack-details-empty">整合包里还没有 Agent 预设。</div>
        ) : (
          <div className="pack-detail-items">
            {pack.presets!.map(item => {
              const toggling = busy === `pack-toggle-preset:${pack.id}:${item.name}`
              const removing = busy === `pack-remove-preset:${pack.id}:${item.name}`
              return (
                <div className={`pack-detail-item ${item.enabled ? '' : 'disabled'}`} key={item.name}>
                  <code>{item.name}</code>
                  <label className="switch" title={item.enabled ? '停用该预设' : '启用该预设'}>
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      disabled={busy !== null}
                      onChange={event => onTogglePreset(item.name, event.target.checked)}
                      aria-label={`${item.enabled ? '停用' : '启用'} 预设 ${item.name}`}
                    />
                    <span>{toggling && <LoaderCircle className="spin" size={11} />}</span>
                  </label>
                  <button
                    type="button"
                    className="pack-detail-remove"
                    disabled={busy !== null}
                    onClick={() => onRemovePreset(item.name)}
                    title="从整合包移除预设"
                    aria-label={`从整合包移除预设 ${item.name}`}
                  >
                    {removing ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {addingOpen && (
        <AddPluginsDialog
          pack={pack}
          candidates={candidates}
          busy={busy !== null}
          onCancel={() => setAddingOpen(false)}
          onConfirm={packageNames => {
            onAddPlugins(packageNames)
            setAddingOpen(false)
          }}
        />
      )}
      {addingPresetsOpen && (
        <AddPresetsDialog
          pack={pack}
          candidates={presetCandidates}
          busy={busy !== null}
          onCancel={() => setAddingPresetsOpen(false)}
          onConfirm={presetNames => {
            onAddPresets(presetNames)
            setAddingPresetsOpen(false)
          }}
        />
      )}
    </aside>
  )
}

function AddPluginsDialog({ pack, candidates, busy, onCancel, onConfirm }: {
  pack: PackStatus
  candidates: ManagedPlugin[]
  busy: boolean
  onCancel: () => void
  onConfirm: (packageNames: string[]) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const toggle = (packageName: string) => {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(packageName)) next.delete(packageName)
      else next.add(packageName)
      return next
    })
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !busy) onCancel() }}>
      <section className="modal add-plugin-dialog" role="dialog" aria-modal="true" aria-labelledby="add-plugin-title">
        <header>
          <div><Plus size={18} /><h2 id="add-plugin-title">添加插件到「{pack.name}」</h2></div>
          <button type="button" className="icon-button" onClick={onCancel} disabled={busy} aria-label="关闭"><X size={17} /></button>
        </header>
        <div className="modal-content">
          <p className="add-plugin-summary">从当前 Profile 已安装插件中勾选，确认后逐个加入整合包。</p>
          {candidates.length === 0 ? (
            <div className="pack-checklist-empty">当前 Profile 没有可添加的新插件。</div>
          ) : (
            <div className="add-plugin-list">
              {candidates.map(plugin => {
                const checked = selected.has(plugin.packageName)
                return (
                  <label className={`pack-checklist-item ${checked ? 'checked' : ''}`} key={plugin.packageName}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(plugin.packageName)} aria-label={`${checked ? '取消' : '选择'} ${plugin.packageName}`} />
                    <span className="pack-item-glyph">{plugin.displayName.slice(0, 2).toUpperCase()}</span>
                    <span className="pack-checklist-copy">
                      <strong>{plugin.displayName}</strong>
                      <small>{plugin.packageName}</small>
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>取消</button>
          <button type="button" className="primary-command" disabled={busy || selected.size === 0} onClick={() => onConfirm(Array.from(selected))}>
            <Plus size={16} />添加 {selected.size > 0 ? `（${selected.size}）` : ''}
          </button>
        </footer>
      </section>
    </div>
  )
}

function AddPresetsDialog({ pack, candidates, busy, onCancel, onConfirm }: {
  pack: PackStatus
  candidates: InstalledPreset[]
  busy: boolean
  onCancel: () => void
  onConfirm: (presetNames: string[]) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const toggle = (presetName: string) => {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(presetName)) next.delete(presetName)
      else next.add(presetName)
      return next
    })
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !busy) onCancel() }}>
      <section className="modal add-plugin-dialog" role="dialog" aria-modal="true" aria-labelledby="add-preset-title">
        <header>
          <div><Plus size={18} /><h2 id="add-preset-title">添加预设到「{pack.name}」</h2></div>
          <button type="button" className="icon-button" onClick={onCancel} disabled={busy} aria-label="关闭"><X size={17} /></button>
        </header>
        <div className="modal-content">
          <p className="add-plugin-summary">从当前环境已安装且有来源记录的 Agent 预设中勾选。</p>
          {candidates.length === 0 ? (
            <div className="pack-checklist-empty">当前没有可添加的 Agent 预设。</div>
          ) : (
            <div className="add-plugin-list">
              {candidates.map(preset => {
                const checked = selected.has(preset.name)
                return (
                  <label className={`pack-checklist-item ${checked ? 'checked' : ''}`} key={preset.name}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(preset.name)} aria-label={`${checked ? '取消' : '选择'} 预设 ${preset.name}`} />
                    <span className="pack-item-glyph">{preset.name.slice(0, 2).toUpperCase()}</span>
                    <span className="pack-checklist-copy">
                      <strong>{preset.name}</strong>
                      <small>{preset.repository ?? '本地预设'}</small>
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>取消</button>
          <button type="button" className="primary-command" disabled={busy || selected.size === 0} onClick={() => onConfirm(Array.from(selected))}>
            <Plus size={16} />添加 {selected.size > 0 ? `（${selected.size}）` : ''}
          </button>
        </footer>
      </section>
    </div>
  )
}

function RemovePackDialog({ pack, busy, onCancel, onConfirm }: {
  pack: PackStatus
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-pack-title">
        <div className="confirm-icon"><Trash2 size={22} /></div>
        <h2 id="remove-pack-title">删除整合包「{pack.name}」？</h2>
        <p>
          这会移除该整合包及其 Profile。
          {pack.enabled ? '它当前正在使用，删除前会自动停用并恢复默认配置。' : '此操作不可撤销。'}
        </p>
        <footer>
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>取消</button>
          <button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}确认删除
          </button>
        </footer>
      </section>
    </div>
  )
}

const packsStyle = `
.packs-stats { grid-template-columns: 110px 110px 130px; }

.packs-layout {
  display: grid; grid-template-columns: minmax(640px, 1fr) 320px;
  min-height: 510px; border: 1px solid var(--line); border-radius: 7px;
  background: var(--surface); overflow: hidden;
}
.packs-list-panel { min-width: 0; border-right: 1px solid var(--line); }
.pack-row {
  display: flex; min-height: 96px; align-items: center; justify-content: space-between;
  padding: 12px 14px; gap: 14px; border-bottom: 1px solid var(--line); cursor: pointer;
}
.pack-row:last-child { border-bottom: 0; }
.pack-row:hover { background: var(--surface-soft); }
.pack-row.selected { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
.pack-row-main { display: grid; min-width: 0; grid-template-columns: 42px minmax(0, 1fr); align-items: center; gap: 12px; }
.pack-glyph {
  display: grid; width: 40px; height: 40px; place-items: center;
  border: 1px solid #bddae0; border-radius: 8px;
  color: #236a76; background: #edf7f8; font-size: 12px; font-weight: 750;
}
.pack-glyph.zip { color: #75521d; border-color: #ead9bb; background: #fbf6eb; }
.pack-glyph.manifest { color: #2866a0; border-color: #b7cfdd; background: var(--blue-soft); }
.pack-row-copy { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.pack-title-line { display: flex; align-items: center; gap: 7px; }
.pack-title-line strong { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.pack-row-copy p { overflow: hidden; margin: 0; color: var(--muted); font-size: 11px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.pack-row-copy small { color: var(--quiet); font-size: 10px; }
.pack-source-badge { padding: 1px 8px; border: 1px solid #b9d7c7; border-radius: 999px; color: var(--accent); background: var(--accent-soft); font-size: 10px; font-weight: 650; }
.pack-state-badge { padding: 1px 8px; border-radius: 999px; font-size: 10px; font-weight: 650; }
.pack-state-badge.complete { color: var(--muted); background: var(--surface-strong); }
.pack-state-badge.partial { color: var(--amber); background: var(--amber-soft); }
.pack-state-badge.failed { color: var(--danger); background: var(--danger-soft); }
.pack-active-badge { padding: 1px 8px; border-radius: 999px; color: #fff; background: var(--accent); font-size: 10px; font-weight: 650; }
.pack-row-actions { display: flex; flex: 0 0 auto; align-items: center; justify-content: flex-end; gap: 7px; flex-wrap: wrap; }

.pack-details { display: flex; flex-direction: column; padding: 16px; background: #fbfcfb; }
.pack-details.empty { align-items: center; justify-content: center; color: var(--quiet); font-size: 12px; }
.pack-details-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.pack-details-head h2 { margin: 0; font-size: 17px; overflow-wrap: anywhere; }
.pack-details-head p { margin: 5px 0 0; color: var(--muted); font-size: 11px; line-height: 17px; overflow-wrap: anywhere; }
.pack-details-meta { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 7px 12px; margin: 16px 0 0; }
.pack-details-meta > div { display: contents; }
.pack-details-meta dt { color: var(--quiet); font-size: 10px; }
.pack-details-meta dd { margin: 0; font-size: 11px; overflow-wrap: anywhere; }
.pack-details-meta dd.complete { color: var(--accent); }
.pack-details-meta dd.partial { color: var(--amber); }
.pack-details-meta dd.failed { color: var(--danger); }
.pack-details-failures { display: flex; flex-direction: column; margin-top: 14px; gap: 7px; }
.pack-details-failures-head > span { font-size: 11px; font-weight: 650; }
.pack-failure-items { display: flex; flex-direction: column; gap: 5px; }
.pack-failure-row {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  padding: 7px 10px; border: 1px solid #e4bcbc; border-radius: 6px; background: #fff5f4;
}
.pack-failure-row code { color: var(--danger); font-size: 10px; }
.pack-failure-row span { color: var(--muted); font-size: 10px; text-align: right; overflow-wrap: anywhere; }
.pack-details-plugins { display: flex; min-height: 0; flex-direction: column; margin-top: 18px; gap: 8px; }
.pack-details-plugins-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pack-details-plugins-head > span { font-size: 11px; font-weight: 650; }
.pack-detail-items { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.pack-detail-item {
  display: grid; grid-template-columns: minmax(0, 1fr) 35px 26px;
  align-items: center; padding: 7px 9px; gap: 6px;
  border-bottom: 1px solid var(--line); background: #fff;
}
.pack-detail-item:last-child { border-bottom: 0; }
.pack-detail-item.disabled { background: #f7f9f7; }
.pack-detail-item.disabled code { color: var(--quiet); text-decoration: line-through; }
.pack-detail-item code { overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.pack-detail-remove {
  display: grid; width: 25px; height: 25px; place-items: center;
  border: 0; border-radius: 5px; color: var(--muted); background: transparent; cursor: pointer;
}
.pack-detail-remove:hover:not(:disabled) { color: var(--danger); background: var(--danger-soft); }
.pack-detail-remove:disabled { cursor: default; opacity: 0.45; }
.pack-details-empty { display: flex; min-height: 70px; align-items: center; justify-content: center; border: 1px dashed var(--line-strong); border-radius: 6px; color: var(--quiet); font-size: 11px; }

.empty-state-actions { display: flex; gap: 9px; }

.add-plugin-dialog { width: min(540px, calc(100vw - 32px)); }
.add-plugin-dialog > header { display: flex; min-height: 56px; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid var(--line); }
.add-plugin-dialog > header > div { display: flex; align-items: center; gap: 9px; }
.add-plugin-summary { margin: 0 0 10px; color: var(--muted); font-size: 11px; line-height: 17px; }
.add-plugin-list { display: flex; flex-direction: column; gap: 6px; max-height: 46vh; overflow-y: auto; }

/* 与 CreatePackDialog 共享的插件勾选行样式（inline style 只在组件挂载时存在，这里重复声明保证独立可用）。 */
.pack-checklist-item {
  display: grid; grid-template-columns: 15px 28px minmax(0, 1fr);
  align-items: center; padding: 8px 9px; gap: 8px;
  border: 1px solid var(--line); border-radius: 6px; background: #fff; cursor: pointer;
}
.pack-checklist-item input { width: 14px; height: 14px; accent-color: var(--accent); }
.pack-checklist-item.checked { border-color: #b9d7c7; background: var(--accent-soft); }
.pack-item-glyph {
  display: grid; width: 27px; height: 27px; place-items: center;
  border: 1px solid #bddae0; border-radius: 6px;
  color: #236a76; background: #edf7f8; font-size: 10px; font-weight: 700;
}
.pack-checklist-copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.pack-checklist-copy strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.pack-checklist-copy small { overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.pack-checklist-empty {
  display: flex; min-height: 90px; align-items: center; justify-content: center;
  margin-top: 9px; border: 1px dashed var(--line-strong); border-radius: 6px;
  color: var(--muted); font-size: 11px;
}
`
