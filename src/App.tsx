import { Layers3, LoaderCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { LauncherApiProvider, resolveLauncherApi, useLauncherApi } from './api/client'
import { AppHeader } from './components/AppHeader'
import { LauncherHome } from './components/LauncherHome'
import { SideNavigation } from './components/SideNavigation'
import { Toast } from './components/Toast'
import { AiInstallDialog } from './components/dialogs/AiInstallDialog'
import { ConfirmDialog } from './components/dialogs/ConfirmDialog'
import { CredentialDialog } from './components/dialogs/CredentialDialog'
import { SettingsDialog } from './components/dialogs/SettingsDialog'
import { DSH_REPOSITORY } from './constants'
import { useAiInstall } from './hooks/use-ai-install'
import { BUSY } from './hooks/use-async-action'
import { useLauncherStore } from './hooks/use-launcher-store'
import { useNavigation } from './hooks/use-navigation'
import { isInstallProgressActive } from './lib/install-progress'
import type { CatalogRepositoryAnalysis, ManagedPlugin } from './types'
import { DiscoverView } from './views/DiscoverView'
import { PluginsView } from './views/PluginsView'
import { RuntimeView } from './views/RuntimeView'

/**
 * 应用根。
 * 只做三件事：提供主进程 API、组装状态与视图、挂载对话框。
 * 业务逻辑在 hooks 里，展示逻辑在 components 与 views 里。
 */
export default function App() {
  const api = useMemo(() => resolveLauncherApi(), [])
  return (
    <LauncherApiProvider value={api}>
      <LauncherShell />
    </LauncherApiProvider>
  )
}

function LauncherShell() {
  const api = useLauncherApi()
  const store = useLauncherStore()
  const navigation = useNavigation(message => store.showToast({ kind: 'error', message }))
  // AI 可能改 profile（安装组件），任务结束时刷新一次；toast 复用 store 的唯一实例。
  const ai = useAiInstall(() => { void store.refreshProfile() }, store.showToast)

  // 对话框开关是纯展示状态，不进 store。
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [credentialOpen, setCredentialOpen] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState<ManagedPlugin | null>(null)
  // 仓库结构检测结果由各视图发起，App 统一持有，避免切页后丢失。
  const [repositoryAnalyses, setRepositoryAnalyses] = useState<Record<string, CatalogRepositoryAnalysis>>({})

  const installingDsh = store.busy === BUSY.dshInstall
    || (isInstallProgressActive(store.installProgress) && store.installProgress.kind === 'dsh')
  const runtimeBusy = store.busy === BUSY.runtime || installingDsh

  const toggleRuntime = async () => {
    // 刚启动时自动切到日志视图，让用户看到启动过程。
    if (await store.toggleRuntime() === 'started') navigation.setView('runtime')
  }

  const openHarness = () => {
    if (store.runtime.url) void api.openExternal(store.runtime.url)
  }

  const closeWindow = () => void api.closeWindow()

  if (store.loading || !store.settings || !store.profile) {
    return (
      <div className="app-loading">
        <div className="brand-mark"><Layers3 size={22} /></div>
        <LoaderCircle className="spin" size={22} />
        <span>正在读取 DSH 配置</span>
      </div>
    )
  }

  const { settings, profile } = store

  return (
    <>
      {navigation.surface === 'launcher' ? (
        <LauncherHome
          settings={settings}
          profile={profile}
          runtime={store.runtime}
          dshInstallation={store.dshInstallation}
          installProgress={store.installProgress?.repository === DSH_REPOSITORY ? store.installProgress : null}
          busy={runtimeBusy}
          installingDsh={installingDsh}
          onCredential={() => setCredentialOpen(true)}
          onManage={navigation.showManager}
          onToggleRuntime={toggleRuntime}
          onOpenHarness={openHarness}
          onClose={closeWindow}
        />
      ) : (
        <div className="app-shell">
          <AppHeader
            runtime={store.runtime}
            busy={runtimeBusy}
            dshInstalled={store.dshInstallation.installed}
            installingDsh={installingDsh}
            profileName={settings.profileName}
            credentialStatus={store.credentialStatus}
            onBack={navigation.showLauncher}
            onCredential={() => setCredentialOpen(true)}
            onSettings={() => setSettingsOpen(true)}
            onToggleRuntime={toggleRuntime}
            onClose={closeWindow}
          />
          <div className="app-body">
            <SideNavigation
              view={navigation.view}
              profile={profile}
              runtime={store.runtime}
              profileName={settings.profileName}
              onChange={navigation.setView}
            />
            <main className="workspace">
              {navigation.view === 'plugins' && (
                <PluginsView
                  profile={profile}
                  installedSkills={store.installedSkills}
                  selected={store.selected}
                  busy={store.busy}
                  onSelect={plugin => store.selectPlugin(plugin.packageName)}
                  onToggle={store.togglePlugin}
                  onToggleSkill={store.toggleSkill}
                  onReorder={store.reorderPlugins}
                  onRefresh={store.refreshProfile}
                  onBrowse={() => navigation.setView('discover')}
                  onOpenPath={path => void api.openPath(path)}
                  onOpenRepository={url => void api.openExternal(url)}
                  onUninstall={setConfirmingRemoval}
                />
              )}
              {navigation.view === 'discover' && (
                <DiscoverView
                  profile={profile}
                  analyses={repositoryAnalyses}
                  installProgress={store.installProgress}
                  installedRepositories={store.installedRepositories}
                  installedSkills={store.installedSkills}
                  onAnalysis={(repository, analysis) => {
                    setRepositoryAnalyses(current => ({ ...current, [repository]: analysis }))
                  }}
                  onInstallationState={store.adoptCatalogInstallationState}
                  onInstallStarted={store.beginInstall}
                  onInstallFinished={store.finishInstall}
                  onPluginInstalled={(repository, result) => {
                    store.applyCatalogPluginInstall(repository, result)
                    store.showToast({
                      kind: 'success',
                      message: result.kind === 'dsh'
                        ? `本地 DSH ${result.dshInstallation.version ?? ''} 已安装。`
                        : `${result.packageName ?? '插件'} 已安装到 ${result.installedProfileName ?? settings.profileName} Profile。`,
                    })
                  }}
                  onSkillInstalled={result => {
                    store.applyCatalogSkillInstall(result)
                    store.showToast({ kind: 'success', message: `${result.installedSkill.name} 已安装到本地 Skill 目录。` })
                  }}
                  onError={message => store.showToast({ kind: 'error', message })}
                  onOpenRepository={url => void api.openExternal(url)}
                  onAiInstall={repo => { void ai.start(repo.fullName, repo.defaultBranch) }}
                  aiRepository={ai.active ? ai.status.repository : null}
                  aiActive={ai.active}
                />
              )}
              {navigation.view === 'runtime' && (
                <RuntimeView
                  runtime={store.runtime}
                  settings={settings}
                  logs={store.logs}
                  busy={runtimeBusy}
                  onToggleRuntime={toggleRuntime}
                  onOpenHarness={openHarness}
                  onClearLogs={store.clearLogs}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              )}
            </main>
          </div>
        </div>
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          busy={store.busy === BUSY.settings}
          onClose={() => setSettingsOpen(false)}
          onSave={async next => { if (await store.saveSettings(next)) setSettingsOpen(false) }}
        />
      )}
      {credentialOpen && (
        <CredentialDialog
          status={store.credentialStatus}
          busy={store.busy === BUSY.credential}
          onClose={() => setCredentialOpen(false)}
          onSave={async apiKey => { if (await store.saveApiKey(apiKey)) setCredentialOpen(false) }}
          onClear={async () => { if (await store.clearApiKey()) setCredentialOpen(false) }}
        />
      )}
      {confirmingRemoval && (
        <ConfirmDialog
          plugin={confirmingRemoval}
          onCancel={() => setConfirmingRemoval(null)}
          onConfirm={() => {
            const plugin = confirmingRemoval
            setConfirmingRemoval(null)
            void store.uninstallPlugin(plugin)
          }}
        />
      )}
      {(ai.active || ai.settled) && (
        <AiInstallDialog
          status={ai.status}
          logs={ai.logs}
          pendingApproval={ai.pendingApproval}
          hasSnapshot={ai.hasSnapshot}
          busy={ai.busy !== null}
          onApprove={ai.approve}
          onCancel={ai.cancel}
          onRollback={() => void ai.rollback()}
          onClose={ai.reset}
        />
      )}
      {store.toast && <Toast toast={store.toast} onClose={store.dismissToast} />}
    </>
  )
}
