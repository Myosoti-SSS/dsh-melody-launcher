import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { copyFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { IPC, IPC_EVENTS } from '../src/constants'
import type { ApplicationInstallRequest, AppSettings, CustomApiProviderInput, PackCreateRequest, PluginInstallRequest, PresetInstallRequest, SkillInstallRequest, WindowMode } from '../src/types'
import type { ApplicationAddonManager } from './application-addons'
import { isWindowMode } from './app-window'
import { clearDeepSeekApiKey, getDeepSeekCredentialStatus, setDeepSeekApiKey } from './credentials'
import { listCustomApiProviders, removeCustomApiProvider, saveCustomApiProvider } from './custom-api'
import { searchCatalogRepositories, type DiscoverySort } from './discovery'
import { importCatalogFromUrl } from './github-import'
import type { Installer } from './installer'
import type { LauncherUpdater } from './launcher-update'
import type { AiInstaller } from './ai-install'
import { assertMeaningfulPackName } from './pack-manifest'
import { MAX_RAW_ARCHIVE_BYTES } from './pack-scan'
import type { PackManager } from './pack'
import type { PluginTrialManager } from './plugin-trial'
import type { CatalogSyncService } from './catalog-sync'
import {
  isSafePackageName,
  isSafeProfileName,
  isSafeRepositoryName,
  readProfile,
  reorderPlugins,
  togglePlugin,
} from './profile'
import type { RuntimeController } from './runtime'
import type { SettingsStore } from './settings'
import type { GitHubAuthService } from './github-auth'
import { createLinkedComponentController } from './linked-components'

/**
 * 渲染层能触达主进程的全部入口。
 * 集中在一处，便于一眼看全攻击面：每个 handler 都先校验入参再进业务逻辑。
 */

export interface IpcDependencies {
  settings: SettingsStore
  runtime: RuntimeController
  installer: Installer
  launcherUpdater: LauncherUpdater
  pluginTrial: PluginTrialManager
  aiInstaller: AiInstaller
  packManager: PackManager
  githubAuth: GitHubAuthService
  applicationAddons: ApplicationAddonManager
  catalogSync: CatalogSyncService
  getWindow: () => BrowserWindow | null
  setWindowMode: (mode: WindowMode) => void
}

export function registerIpcHandlers(deps: IpcDependencies): void {
  const { settings, runtime, installer, launcherUpdater, pluginTrial, aiInstaller, packManager, githubAuth, applicationAddons, catalogSync } = deps
  const linkedComponents = createLinkedComponentController({
    readSettings: () => settings.read(),
    readProfile,
    togglePlugin,
    applications: applicationAddons,
    isRuntimeRunning: () => runtime.isRunning(),
  })

  ipcMain.handle(IPC.settingsGet, () => settings.read())
  ipcMain.handle(IPC.settingsSave, (_event, next: AppSettings) => settings.save(next))
  ipcMain.handle(IPC.dshDetect, () => installer.detectDsh())
  ipcMain.handle(IPC.dshUpdateCheck, () => installer.checkDshUpdate())
  ipcMain.handle(IPC.launcherUpdateCheck, () => launcherUpdater.check())
  ipcMain.handle(IPC.launcherUpdateDownload, () => launcherUpdater.download())
  ipcMain.handle(IPC.launcherUpdateApply, () => launcherUpdater.apply())

  ipcMain.handle(IPC.credentialStatus, async () => {
    const current = await settings.read()
    return getDeepSeekCredentialStatus(current.dshHome)
  })
  ipcMain.handle(IPC.credentialSet, async (_event, apiKey: string) => {
    if (typeof apiKey !== 'string') throw new Error('API Key 格式无效。')
    const current = await settings.read()
    return setDeepSeekApiKey(current.dshHome, apiKey)
  })
  ipcMain.handle(IPC.credentialClear, async () => {
    const current = await settings.read()
    return clearDeepSeekApiKey(current.dshHome)
  })
  ipcMain.handle(IPC.customApiList, async () => {
    const current = await settings.read()
    return listCustomApiProviders(current.dshHome)
  })
  ipcMain.handle(IPC.customApiSave, async (_event, input: CustomApiProviderInput) => {
    const current = await settings.read()
    return saveCustomApiProvider(current.dshHome, input)
  })
  ipcMain.handle(IPC.customApiRemove, async (_event, route: string) => {
    if (typeof route !== 'string') throw new Error('自定义 API 路由格式无效。')
    const current = await settings.read()
    return removeCustomApiProvider(current.dshHome, route)
  })

  ipcMain.handle(IPC.githubAuthStatus, () => githubAuth.getStatus())
  ipcMain.handle(IPC.githubAuthTokenLogin, (_event, token: string) => {
    if (typeof token !== 'string') throw new Error('GitHub 访问令牌格式无效。')
    return githubAuth.loginWithToken(token)
  })
  ipcMain.handle(IPC.githubAuthDeviceBegin, async () => {
    const authorization = await githubAuth.beginDeviceLogin()
    await shell.openExternal(authorization.verificationUri)
    return authorization
  })
  ipcMain.handle(IPC.githubAuthDeviceComplete, () => githubAuth.completeDeviceLogin())
  ipcMain.handle(IPC.githubAuthDeviceCancel, () => githubAuth.cancelDeviceLogin())
  ipcMain.handle(IPC.githubAuthLogout, () => githubAuth.logout())
  ipcMain.handle(IPC.githubPullRequests, () => githubAuth.listRecentPullRequests())
  ipcMain.handle(IPC.githubStarStatus, (_event, repository: string) => githubAuth.getStarStatus(repository))
  ipcMain.handle(IPC.githubStarSet, (_event, payload: { repository: string; starred: boolean }) => {
    if (!payload || typeof payload.repository !== 'string') throw new Error('GitHub 仓库名称无效。')
    return githubAuth.setStar(payload.repository, Boolean(payload.starred))
  })

  ipcMain.handle(IPC.chooseDirectory, async (_event, kind: 'dshInstallPath' | 'dshHome' | 'workspace') => {
    const window = deps.getWindow()
    if (!window) return null
    const current = await settings.read()
    const defaultPath = kind === 'dshInstallPath' ? current.dshInstallPath : kind === 'dshHome' ? current.dshHome : current.workspace
    const result = await dialog.showOpenDialog(window, {
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.profileRead, async () => {
    const current = await settings.read()
    return readProfile(current.dshHome, current.profileName)
  })
  ipcMain.handle(IPC.profileToggle, async (_event, payload: { packageName: string; enabled: boolean; profileName?: string }) => {
    if (!isSafePackageName(payload.packageName)) throw new Error('插件名称无效。')
    if (payload.profileName !== undefined && !isSafeProfileName(payload.profileName)) throw new Error('Profile 名称无效。')
    return linkedComponents.togglePlugin(payload.packageName, Boolean(payload.enabled), payload.profileName)
  })
  ipcMain.handle(IPC.profileReorder, async (_event, packageNames: string[]) => {
    if (!Array.isArray(packageNames) || packageNames.some(name => !isSafePackageName(name))) {
      throw new Error('插件顺序无效。')
    }
    const current = await settings.read()
    return reorderPlugins(current.dshHome, current.profileName, packageNames)
  })

  ipcMain.handle(IPC.catalogDiscover, async (_event, payload: { query: string; sort: DiscoverySort; page: number }) => {
    const sort: DiscoverySort = payload.sort === 'updated' ? 'updated' : 'stars'
    const page = Math.max(1, Math.floor(Number(payload.page) || 1))
    const [found, dshInstallation, installedRepositories, installedSkills, installedApplications, installedPresets] = await Promise.all([
      searchCatalogRepositories(payload.query ?? '', sort, page, githubAuth.fetch),
      installer.detectDsh(),
      installer.listInstalledRepositories(),
      installer.readInstalledSkills(),
      applicationAddons.list(),
      installer.readInstalledPresets(),
    ])
    return {
      ...found,
      dshInstallation,
      installedRepositories,
      installedSkills,
      installedApplications,
      installedPresets,
    }
  })
  ipcMain.handle(IPC.catalogAnalyze, async (event, payload: { fullName: string; defaultBranch: string; repositoryUpdatedAt?: string }) => {
    if (!isSafeRepositoryName(payload.fullName)) throw new Error('GitHub 仓库名称无效。')
    if (payload.repositoryUpdatedAt !== undefined && !Number.isFinite(Date.parse(payload.repositoryUpdatedAt))) {
      throw new Error('GitHub 仓库更新时间无效。')
    }
    return catalogSync.resolve(
      payload.fullName,
      payload.defaultBranch,
      payload.repositoryUpdatedAt,
      () => installer.analyzeCatalogRepository(payload.fullName, payload.defaultBranch, progress => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.catalogAnalysisProgress, progress)
      }, { bypassCache: true }),
      message => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.catalogAnalysisProgress, {
          repository: payload.fullName,
          phase: 'preparing',
          message,
          completed: 0,
          total: 3,
          checks: { plugin: 'pending', skill: 'pending', application: 'pending' },
        })
      },
    )
  })
  // 从 GitHub 链接导入：解析 → 取元数据 → 复用现有分析（只读，无需整合包互斥）。
  ipcMain.handle(IPC.catalogImportUrl, async (event, payload: { url: string }) => {
    if (!payload || typeof payload.url !== 'string' || payload.url.trim().length === 0) {
      throw new Error('请输入 GitHub 仓库链接。')
    }
    if (payload.url.length > 1000) throw new Error('GitHub 仓库链接过长。')
    return importCatalogFromUrl(
      payload.url,
      (fullName, branch, repositoryUpdatedAt) => catalogSync.resolve(
        fullName,
        branch,
        repositoryUpdatedAt,
        () => installer.analyzeCatalogRepository(fullName, branch, progress => {
          if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.catalogAnalysisProgress, progress)
        }, { bypassCache: true }),
        message => {
          if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.catalogAnalysisProgress, {
            repository: fullName,
            phase: 'preparing',
            message,
            completed: 0,
            total: 3,
            checks: { plugin: 'pending', skill: 'pending', application: 'pending' },
          })
        },
      ),
      githubAuth.fetch,
    )
  })
  ipcMain.handle(IPC.pluginsInstall, async (_event, request: string | PluginInstallRequest) => {
    if (packManager.isBusy()) throw new Error('整合包操作进行中')
    if (pluginTrial.isBusy()) throw new Error('插件试运行进行中')
    if (applicationAddons.isBusy()) throw new Error('应用加载项操作进行中')
    const fullName = typeof request === 'string' ? request : request.repository
    if (!isSafeRepositoryName(fullName)) throw new Error('GitHub 仓库名称无效。')
    if (typeof request === 'string') return installer.install(fullName)
    return installer.installPluginTarget({
      repository: request.repository,
      defaultBranch: request.defaultBranch,
      targetId: request.targetId,
      // release 源插件：meta-repo 分析得到的 tgz 直链，覆盖重分析得到的 github 源。
      tarballUrl: typeof request.tarballUrl === 'string' ? request.tarballUrl : undefined,
    })
  })
  ipcMain.handle(IPC.pluginsUninstall, async (_event, payload: string | { packageName: string; profileName?: string }) => {
    if (packManager.isBusy()) throw new Error('整合包操作进行中')
    if (pluginTrial.isBusy()) throw new Error('插件试运行进行中')
    if (applicationAddons.isBusy()) throw new Error('应用加载项操作进行中')
    const packageName = typeof payload === 'string' ? payload : payload?.packageName
    if (!isSafePackageName(packageName)) throw new Error('插件名称无效。')
    const profileName = typeof payload === 'object' ? payload.profileName : undefined
    if (profileName !== undefined && !isSafeProfileName(profileName)) throw new Error('Profile 名称无效。')
    return installer.remove(packageName, profileName)
  })
  ipcMain.handle(IPC.pluginsTrialRead, () => pluginTrial.list())
  ipcMain.handle(IPC.pluginsTrial, async (_event, payload: { packageName: string; profileName?: string }) => {
    if (!payload || !isSafePackageName(payload.packageName)) throw new Error('插件名称无效。')
    if (payload.profileName !== undefined && !isSafeProfileName(payload.profileName)) throw new Error('Profile 名称无效。')
    if (packManager.isBusy()) throw new Error('整合包操作进行中')
    if (aiInstaller.isBusy()) throw new Error('AI 任务进行中')
    if (applicationAddons.isBusy()) throw new Error('应用加载项操作进行中')
    return pluginTrial.trial(payload.packageName, payload.profileName)
  })

  ipcMain.handle(IPC.skillsInstall, async (_event, request: SkillInstallRequest) => {
    if (packManager.isBusy()) throw new Error('整合包操作进行中')
    if (applicationAddons.isBusy()) throw new Error('应用加载项操作进行中')
    if (!isSafeRepositoryName(request.repository)) throw new Error('GitHub 仓库名称无效。')
    return installer.installSkill(request)
  })
  ipcMain.handle(IPC.skillsReadInstalled, () => installer.readInstalledSkills())
  ipcMain.handle(IPC.skillsToggle, async (_event, payload: { name: string; enabled: boolean }) => {
    if (!payload || typeof payload.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.name)) {
      throw new Error('Skill 名称无效。')
    }
    return installer.toggleSkill(payload.name, Boolean(payload.enabled))
  })

  ipcMain.handle(IPC.applicationsReadInstalled, () => applicationAddons.list())
  ipcMain.handle(IPC.applicationsInstall, async (_event, request: ApplicationInstallRequest) => {
    if (!request || !isSafeRepositoryName(request.repository)) throw new Error('GitHub 仓库名称无效。')
    if (typeof request.defaultBranch !== 'string' || typeof request.targetId !== 'string') throw new Error('应用加载项请求无效。')
    if (packManager.isBusy()) throw new Error('整合包操作进行中')
    if (pluginTrial.isBusy()) throw new Error('插件试运行进行中')
    if (aiInstaller.isBusy()) throw new Error('AI 任务进行中')
    if (installer.isBusy()) throw new Error('插件安装操作进行中')

    const installed = await applicationAddons.install(request)
    const current = await settings.read()
    const profile = await readProfile(current.dshHome, current.profileName)
    return { ...installed, profile }
  })
  ipcMain.handle(IPC.applicationsToggle, async (_event, payload: { id: string; enabled: boolean }) => {
    if (!payload || typeof payload.id !== 'string') throw new Error('应用加载项标识无效。')
    return linkedComponents.toggleApplication(payload.id, Boolean(payload.enabled))
  })
  ipcMain.handle(IPC.applicationsUninstall, async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('应用加载项标识无效。')
    return applicationAddons.uninstall(id)
  })

  ipcMain.handle(IPC.presetsInstall, async (_event, request: PresetInstallRequest) => {
    if (packManager.isBusy()) throw new Error('整合包操作进行中')
    if (!request || typeof request !== 'object') throw new Error('请求格式无效。')
    if (!isSafeRepositoryName(request.repository)) throw new Error('GitHub 仓库名称无效。')
    if (typeof request.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(request.name)) {
      throw new Error('预设名称无效。')
    }
    return installer.installPreset(request)
  })
  ipcMain.handle(IPC.presetsReadInstalled, () => installer.readInstalledPresets())
  ipcMain.handle(IPC.presetsToggle, async (_event, payload: { name: string; enabled: boolean }) => {
    if (!payload || typeof payload.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.name)) {
      throw new Error('预设名称无效。')
    }
    return installer.togglePreset(payload.name, Boolean(payload.enabled))
  })

  ipcMain.handle(IPC.aiStatus, () => aiInstaller.status())
  ipcMain.handle(IPC.aiHasSnapshot, () => aiInstaller.hasSnapshot())
  ipcMain.handle(IPC.aiInstall, async (_event, input: { repository: string; defaultBranch: string }) => {
    if (packManager.isBusy()) throw new Error('整合包操作进行中')
    if (pluginTrial.isBusy()) throw new Error('插件试运行进行中')
    if (applicationAddons.isBusy()) throw new Error('应用加载项操作进行中')
    if (!input || !isSafeRepositoryName(input.repository)) throw new Error('GitHub 仓库名称无效。')
    if (typeof input.defaultBranch !== 'string' || input.defaultBranch.length === 0 || input.defaultBranch.length > 200) {
      throw new Error('分支无效。')
    }
    // 主进程内 aiInstaller.start 会重算 analysis，不信任渲染层传入的分类。
    return aiInstaller.start({ repository: input.repository, defaultBranch: input.defaultBranch })
  })
  ipcMain.handle(IPC.aiAdaptPlugin, async (_event, input: { packageName: string; profileName?: string }) => {
    if (!input || !isSafePackageName(input.packageName)) throw new Error('插件名称无效。')
    if (input.profileName !== undefined && !isSafeProfileName(input.profileName)) throw new Error('Profile 名称无效。')
    if (packManager.isBusy()) throw new Error('整合包操作进行中')
    if (pluginTrial.isBusy()) throw new Error('插件试运行进行中')
    const failure = await pluginTrial.latestFailure(input.packageName, input.profileName)
    return aiInstaller.adaptPlugin({
      packageName: failure.packageName,
      profileName: failure.profileName,
      diagnostics: failure.diagnostics,
    })
  })
  ipcMain.handle(IPC.aiRepairRuntime, async () => {
    if (packManager.isBusy()) throw new Error('整合包操作进行中')
    if (pluginTrial.isBusy()) throw new Error('插件试运行进行中')
    const failure = runtime.failure()
    if (!failure) throw new Error('没有找到最近一次 DSH 启动失败诊断。')
    return aiInstaller.repairRuntime(failure)
  })
  ipcMain.handle(IPC.aiApprove, async (_event, requestId: string, allow: boolean) => {
    if (typeof requestId !== 'string' || requestId.length === 0) throw new Error('审批请求无效。')
    return aiInstaller.approve(requestId, Boolean(allow))
  })
  ipcMain.handle(IPC.aiCancel, () => aiInstaller.cancel())
  ipcMain.handle(IPC.aiRollback, () => aiInstaller.rollback())

  /**
   * 校验文件存在、为绝对路径，且文件体积不超过整合包上限（未读入前的第一道闸门）。
   * 门禁放宽到 raw 扫描上限（4 GiB）：真实整合包远超标准包 64MB 限制；
   * 标准包内部仍由 inspectPackZip 的严格限额保证。
   */
  async function assertPackFilePath(target: unknown): Promise<void> {
    if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('路径无效。')
    let stats
    try {
      stats = await stat(target)
    } catch {
      throw new Error('文件不存在。')
    }
    if (!stats.isFile()) throw new Error('不是文件。')
    if (stats.size > MAX_RAW_ARCHIVE_BYTES) throw new Error('整合包压缩包过大。')
  }

  ipcMain.handle(IPC.packsList, () => packManager.listPacks())

  ipcMain.handle(IPC.packsCreate, async (_event, request: PackCreateRequest) => {
    if (!request || typeof request !== 'object') throw new Error('请求格式无效。')
    if (typeof request.name !== 'string') throw new Error('整合包名称无效。')
    assertMeaningfulPackName(request.name) // 空名/纯中文等退化成无意义标识的名称会抛出中文错误
    if (request.description !== undefined && typeof request.description !== 'string') throw new Error('整合包描述无效。')
    if (!Array.isArray(request.packageNames) || request.packageNames.some(name => !isSafePackageName(name))) {
      throw new Error('插件列表无效。')
    }
    if (request.presetNames !== undefined && (
      !Array.isArray(request.presetNames) || request.presetNames.some(name => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    )) {
      throw new Error('预设列表无效。')
    }
    if (request.skillNames !== undefined && (
      !Array.isArray(request.skillNames) || request.skillNames.some(name => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    )) {
      throw new Error('Skill 列表无效。')
    }
    if (request.applicationIds !== undefined && (
      !Array.isArray(request.applicationIds) || request.applicationIds.some(id => !/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/.test(id))
    )) {
      throw new Error('应用加载项列表无效。')
    }
    return packManager.createPack(request)
  })

  ipcMain.handle(IPC.packsAnalyzeImport, async (_event, target: string) => {
    await assertPackFilePath(target)
    return packManager.analyzeImport(target)
  })

  ipcMain.handle(IPC.packsImport, async (_event, target: string, items?: string[], name?: unknown) => {
    await assertPackFilePath(target)
    if (items !== undefined && (!Array.isArray(items) || items.some(item => !isSafePackageName(item)))) {
      throw new Error('插件列表无效。')
    }
    let nameOverride: string | undefined
    if (name !== undefined && name !== null) {
      if (typeof name !== 'string' || !name.trim()) throw new Error('整合包名称无效。')
      assertMeaningfulPackName(name) // 空名/纯中文等退化成无意义标识的名称会抛出中文错误
      nameOverride = name.trim()
    }
    return packManager.importPack(target, items, nameOverride === undefined ? undefined : { name: nameOverride })
  })

  ipcMain.handle(IPC.packsExport, async (_event, packId: string) => {
    if (!isSafeProfileName(packId)) throw new Error('整合包标识无效。')
    const { zipPath, fileName } = await packManager.exportPack(packId)
    const window = deps.getWindow()
    if (!window) {
      await rm(path.dirname(zipPath), { recursive: true, force: true }).catch(() => undefined)
      return null
    }
    try {
      const result = await dialog.showSaveDialog(window, {
        defaultPath: fileName,
        filters: [{ name: '整合包', extensions: ['zip'] }],
      })
      if (result.canceled || !result.filePath) return null
      await copyFile(zipPath, result.filePath)
      return result.filePath
    } finally {
      await rm(path.dirname(zipPath), { recursive: true, force: true }).catch(() => undefined)
    }
  })

  ipcMain.handle(IPC.packsPickFile, async () => {
    const window = deps.getWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: '整合包', extensions: ['zip', 'yaml', 'yml'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.packsActivate, async (_event, packId: string) => {
    if (!isSafeProfileName(packId)) throw new Error('整合包标识无效。')
    return packManager.activatePack(packId)
  })

  ipcMain.handle(IPC.packsDeactivate, () => packManager.deactivatePack())

  ipcMain.handle(IPC.packsRemove, async (_event, packId: string) => {
    if (!isSafeProfileName(packId)) throw new Error('整合包标识无效。')
    return packManager.removePack(packId)
  })

  ipcMain.handle(IPC.packsRollback, () => packManager.rollback())

  ipcMain.handle(IPC.packsHasSnapshot, () => packManager.hasSnapshot())

  ipcMain.handle(IPC.packsAddPlugin, async (_event, payload: { packId: string; packageName: string }) => {
    if (!isSafeProfileName(payload.packId) || !isSafePackageName(payload.packageName)) throw new Error('参数无效。')
    return packManager.addPackPlugin(payload.packId, payload.packageName)
  })

  ipcMain.handle(IPC.packsAddPreset, async (_event, payload: { packId: string; presetName: string }) => {
    if (!isSafeProfileName(payload.packId) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.presetName)) throw new Error('参数无效。')
    return packManager.addPackPreset(payload.packId, payload.presetName)
  })

  ipcMain.handle(IPC.packsTogglePreset, async (_event, payload: { packId: string; presetName: string; enabled: boolean }) => {
    if (!isSafeProfileName(payload.packId) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.presetName)) throw new Error('参数无效。')
    return packManager.togglePackPreset(payload.packId, payload.presetName, Boolean(payload.enabled))
  })

  ipcMain.handle(IPC.packsRemovePreset, async (_event, payload: { packId: string; presetName: string }) => {
    if (!isSafeProfileName(payload.packId) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.presetName)) throw new Error('参数无效。')
    return packManager.removePackPreset(payload.packId, payload.presetName)
  })

  ipcMain.handle(IPC.packsAddSkill, async (_event, payload: { packId: string; skillName: string }) => {
    if (!isSafeProfileName(payload.packId) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.skillName)) throw new Error('参数无效。')
    return packManager.addPackSkill(payload.packId, payload.skillName)
  })

  ipcMain.handle(IPC.packsToggleSkill, async (_event, payload: { packId: string; skillName: string; enabled: boolean }) => {
    if (!isSafeProfileName(payload.packId) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.skillName)) throw new Error('参数无效。')
    return packManager.togglePackSkill(payload.packId, payload.skillName, Boolean(payload.enabled))
  })

  ipcMain.handle(IPC.packsRemoveSkill, async (_event, payload: { packId: string; skillName: string }) => {
    if (!isSafeProfileName(payload.packId) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.skillName)) throw new Error('参数无效。')
    return packManager.removePackSkill(payload.packId, payload.skillName)
  })

  ipcMain.handle(IPC.packsAddApplication, async (_event, payload: { packId: string; addonId: string }) => {
    if (!isSafeProfileName(payload.packId) || !/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/.test(payload.addonId)) throw new Error('参数无效。')
    return packManager.addPackApplication(payload.packId, payload.addonId)
  })

  ipcMain.handle(IPC.packsToggleApplication, async (_event, payload: { packId: string; addonId: string; enabled: boolean }) => {
    if (!isSafeProfileName(payload.packId) || !/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/.test(payload.addonId)) throw new Error('参数无效。')
    return packManager.togglePackApplication(payload.packId, payload.addonId, Boolean(payload.enabled))
  })

  ipcMain.handle(IPC.packsRemoveApplication, async (_event, payload: { packId: string; addonId: string }) => {
    if (!isSafeProfileName(payload.packId) || !/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/.test(payload.addonId)) throw new Error('参数无效。')
    return packManager.removePackApplication(payload.packId, payload.addonId)
  })

  ipcMain.handle(IPC.packsToggleItem, async (_event, payload: { packId: string; packageName: string; enabled: boolean }) => {
    if (!isSafeProfileName(payload.packId) || !isSafePackageName(payload.packageName)) throw new Error('参数无效。')
    return packManager.togglePackItem(payload.packId, payload.packageName, Boolean(payload.enabled))
  })

  ipcMain.handle(IPC.packsRemoveItem, async (_event, payload: { packId: string; packageName: string }) => {
    if (!isSafeProfileName(payload.packId) || !isSafePackageName(payload.packageName)) throw new Error('参数无效。')
    return packManager.removePackItem(payload.packId, payload.packageName)
  })

  ipcMain.handle(IPC.runtimeState, () => runtime.state())
  ipcMain.handle(IPC.runtimeStart, async () => {
    if (pluginTrial.isBusy()) throw new Error('请先等待插件试运行结束。')
    if (aiInstaller.isBusy()) throw new Error('请先等待 AI 任务结束。')
    if (applicationAddons.isBusy()) throw new Error('请先等待应用加载项操作结束。')
    await catalogSync.flushPending()
    return runtime.start()
  })
  ipcMain.handle(IPC.runtimeStop, () => runtime.stop())

  ipcMain.handle(IPC.windowSetMode, (_event, mode: WindowMode) => {
    if (!isWindowMode(mode)) throw new Error('窗口模式无效。')
    deps.setWindowMode(mode)
  })
  ipcMain.handle(IPC.windowClose, () => deps.getWindow()?.close())

  ipcMain.handle(IPC.openExternal, (_event, url: string) => {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只允许打开网页链接。')
    return shell.openExternal(parsed.toString())
  })
  ipcMain.handle(IPC.openPath, async (_event, target: string) => {
    if (!path.isAbsolute(target)) throw new Error('路径无效。')
    await shell.openPath(target)
  })
}
