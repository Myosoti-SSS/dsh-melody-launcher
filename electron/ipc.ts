import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { IPC } from '../src/constants'
import type { AppSettings, PackCreateRequest, PluginInstallRequest, SkillInstallRequest, WindowMode } from '../src/types'
import { isWindowMode } from './app-window'
import { clearDeepSeekApiKey, getDeepSeekCredentialStatus, setDeepSeekApiKey } from './credentials'
import { searchCatalogRepositories, type DiscoverySort } from './discovery'
import type { Installer } from './installer'
import type { AiInstaller } from './ai-install'
import { packProfileName } from './pack-manifest'
import { DEFAULT_PACK_ZIP_LIMITS } from './pack-zip'
import type { PackManager } from './pack'
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

/**
 * 渲染层能触达主进程的全部入口。
 * 集中在一处，便于一眼看全攻击面：每个 handler 都先校验入参再进业务逻辑。
 */

export interface IpcDependencies {
  settings: SettingsStore
  runtime: RuntimeController
  installer: Installer
  aiInstaller: AiInstaller
  packManager: PackManager
  getWindow: () => BrowserWindow | null
  setWindowMode: (mode: WindowMode) => void
}

export function registerIpcHandlers(deps: IpcDependencies): void {
  const { settings, runtime, installer, aiInstaller, packManager } = deps

  ipcMain.handle(IPC.settingsGet, () => settings.read())
  ipcMain.handle(IPC.settingsSave, (_event, next: AppSettings) => settings.save(next))
  ipcMain.handle(IPC.dshDetect, () => installer.detectDsh())
  ipcMain.handle(IPC.dshUpdateCheck, () => installer.checkDshUpdate())

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
    const current = await settings.read()
    return togglePlugin(current.dshHome, payload.profileName ?? current.profileName, payload.packageName, Boolean(payload.enabled))
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
    const [found, dshInstallation, installedRepositories, installedSkills] = await Promise.all([
      searchCatalogRepositories(payload.query ?? '', sort, page),
      installer.detectDsh(),
      installer.listInstalledRepositories(),
      installer.readInstalledSkills(),
    ])
    return {
      ...found,
      dshInstallation,
      installedRepositories,
      installedSkills,
    }
  })
  ipcMain.handle(IPC.catalogAnalyze, async (_event, payload: { fullName: string; defaultBranch: string }) => {
    if (!isSafeRepositoryName(payload.fullName)) throw new Error('GitHub 仓库名称无效。')
    return installer.analyzeCatalogRepository(payload.fullName, payload.defaultBranch)
  })
  ipcMain.handle(IPC.pluginsInstall, async (_event, request: string | PluginInstallRequest) => {
    if (packManager.isBusy()) throw new Error('整合包操作进行中')
    const fullName = typeof request === 'string' ? request : request.repository
    if (!isSafeRepositoryName(fullName)) throw new Error('GitHub 仓库名称无效。')
    if (typeof request === 'string') return installer.install(fullName)
    return installer.installPluginTarget({
      repository: request.repository,
      defaultBranch: request.defaultBranch,
      targetId: request.targetId,
    })
  })
  ipcMain.handle(IPC.pluginsUninstall, async (_event, payload: string | { packageName: string; profileName?: string }) => {
    if (packManager.isBusy()) throw new Error('整合包操作进行中')
    const packageName = typeof payload === 'string' ? payload : payload?.packageName
    if (!isSafePackageName(packageName)) throw new Error('插件名称无效。')
    const profileName = typeof payload === 'object' ? payload.profileName : undefined
    if (profileName !== undefined && !isSafeProfileName(profileName)) throw new Error('Profile 名称无效。')
    return installer.remove(packageName, profileName)
  })

  ipcMain.handle(IPC.skillsInstall, async (_event, request: SkillInstallRequest) => {
    if (packManager.isBusy()) throw new Error('整合包操作进行中')
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

  ipcMain.handle(IPC.aiStatus, () => aiInstaller.status())
  ipcMain.handle(IPC.aiHasSnapshot, () => aiInstaller.hasSnapshot())
  ipcMain.handle(IPC.aiInstall, async (_event, input: { repository: string; defaultBranch: string }) => {
    if (packManager.isBusy()) throw new Error('整合包操作进行中')
    if (!input || !isSafeRepositoryName(input.repository)) throw new Error('GitHub 仓库名称无效。')
    if (typeof input.defaultBranch !== 'string' || input.defaultBranch.length === 0 || input.defaultBranch.length > 200) {
      throw new Error('分支无效。')
    }
    // 主进程内 aiInstaller.start 会重算 analysis，不信任渲染层传入的分类。
    return aiInstaller.start({ repository: input.repository, defaultBranch: input.defaultBranch })
  })
  ipcMain.handle(IPC.aiApprove, async (_event, requestId: string, allow: boolean) => {
    if (typeof requestId !== 'string' || requestId.length === 0) throw new Error('审批请求无效。')
    return aiInstaller.approve(requestId, Boolean(allow))
  })
  ipcMain.handle(IPC.aiCancel, () => aiInstaller.cancel())
  ipcMain.handle(IPC.aiRollback, () => aiInstaller.rollback())

  /** 校验文件存在、为绝对路径，且文件体积不超过整合包上限（未读入前的第一道闸门）。 */
  async function assertPackFilePath(target: unknown): Promise<void> {
    if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('路径无效。')
    let stats
    try {
      stats = await stat(target)
    } catch {
      throw new Error('文件不存在。')
    }
    if (!stats.isFile()) throw new Error('不是文件。')
    if (stats.size > DEFAULT_PACK_ZIP_LIMITS.maxArchiveBytes) throw new Error('整合包压缩包过大。')
  }

  ipcMain.handle(IPC.packsList, () => packManager.listPacks())

  ipcMain.handle(IPC.packsCreate, async (_event, request: PackCreateRequest) => {
    if (!request || typeof request !== 'object') throw new Error('请求格式无效。')
    if (typeof request.name !== 'string') throw new Error('整合包名称无效。')
    packProfileName(request.name) // 非法名称会抛出中文错误
    if (request.description !== undefined && typeof request.description !== 'string') throw new Error('整合包描述无效。')
    if (!Array.isArray(request.packageNames) || request.packageNames.some(name => !isSafePackageName(name))) {
      throw new Error('插件列表无效。')
    }
    return packManager.createPack(request)
  })

  ipcMain.handle(IPC.packsAnalyzeImport, async (_event, target: string) => {
    await assertPackFilePath(target)
    return packManager.analyzeImport(target)
  })

  ipcMain.handle(IPC.packsImport, async (_event, target: string, items?: string[]) => {
    await assertPackFilePath(target)
    if (items !== undefined && (!Array.isArray(items) || items.some(name => !isSafePackageName(name)))) {
      throw new Error('插件列表无效。')
    }
    return packManager.importPack(target, items)
  })

  ipcMain.handle(IPC.packsExport, async (_event, packId: string) => {
    if (!isSafeProfileName(packId)) throw new Error('整合包标识无效。')
    const { zip, fileName } = await packManager.exportPack(packId)
    const window = deps.getWindow()
    if (!window) return null
    const result = await dialog.showSaveDialog(window, {
      defaultPath: fileName,
      filters: [{ name: '整合包', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, zip)
    return result.filePath
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

  ipcMain.handle(IPC.packsToggleItem, async (_event, payload: { packId: string; packageName: string; enabled: boolean }) => {
    if (!isSafeProfileName(payload.packId) || !isSafePackageName(payload.packageName)) throw new Error('参数无效。')
    return packManager.togglePackItem(payload.packId, payload.packageName, Boolean(payload.enabled))
  })

  ipcMain.handle(IPC.packsRemoveItem, async (_event, payload: { packId: string; packageName: string }) => {
    if (!isSafeProfileName(payload.packId) || !isSafePackageName(payload.packageName)) throw new Error('参数无效。')
    return packManager.removePackItem(payload.packId, payload.packageName)
  })

  ipcMain.handle(IPC.runtimeState, () => runtime.state())
  ipcMain.handle(IPC.runtimeStart, () => runtime.start())
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
