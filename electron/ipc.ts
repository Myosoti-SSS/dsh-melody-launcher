import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { IPC } from '../src/constants'
import type { AppSettings, PluginInstallRequest, SkillInstallRequest, WindowMode } from '../src/types'
import { isWindowMode } from './app-window'
import { clearDeepSeekApiKey, getDeepSeekCredentialStatus, setDeepSeekApiKey } from './credentials'
import { searchPluginRepositories, searchSkillRepositories, type DiscoverySort } from './discovery'
import type { Installer } from './installer'
import type { AiInstaller } from './ai-install'
import {
  isSafePackageName,
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
  getWindow: () => BrowserWindow | null
  setWindowMode: (mode: WindowMode) => void
}

export function registerIpcHandlers(deps: IpcDependencies): void {
  const { settings, runtime, installer, aiInstaller } = deps

  ipcMain.handle(IPC.settingsGet, () => settings.read())
  ipcMain.handle(IPC.settingsSave, (_event, next: AppSettings) => settings.save(next))
  ipcMain.handle(IPC.dshDetect, () => installer.detectDsh())

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
  ipcMain.handle(IPC.profileToggle, async (_event, payload: { packageName: string; enabled: boolean }) => {
    if (!isSafePackageName(payload.packageName)) throw new Error('插件名称无效。')
    const current = await settings.read()
    return togglePlugin(current.dshHome, current.profileName, payload.packageName, Boolean(payload.enabled))
  })
  ipcMain.handle(IPC.profileReorder, async (_event, packageNames: string[]) => {
    if (!Array.isArray(packageNames) || packageNames.some(name => !isSafePackageName(name))) {
      throw new Error('插件顺序无效。')
    }
    const current = await settings.read()
    return reorderPlugins(current.dshHome, current.profileName, packageNames)
  })

  ipcMain.handle(IPC.pluginsDiscover, async (_event, payload: { query: string; sort: DiscoverySort; page: number }) => {
    const sort: DiscoverySort = payload.sort === 'updated' ? 'updated' : 'stars'
    const page = Math.min(34, Math.max(1, Math.floor(Number(payload.page) || 1)))
    const found = await searchPluginRepositories(payload.query ?? '', sort, page)
    return {
      ...found,
      dshInstallation: await installer.detectDsh(),
      installedRepositories: await installer.listInstalledRepositories(),
    }
  })
  ipcMain.handle(IPC.pluginsAnalyze, async (_event, payload: { fullName: string; defaultBranch: string }) => {
    if (!isSafeRepositoryName(payload.fullName)) throw new Error('GitHub 仓库名称无效。')
    return installer.analyzePlugin(payload.fullName, payload.defaultBranch)
  })
  ipcMain.handle(IPC.pluginsInstall, async (_event, request: string | PluginInstallRequest) => {
    const fullName = typeof request === 'string' ? request : request.repository
    if (!isSafeRepositoryName(fullName)) throw new Error('GitHub 仓库名称无效。')
    if (typeof request === 'string') return installer.install(fullName)
    return installer.installPluginTarget({
      repository: request.repository,
      defaultBranch: request.defaultBranch,
      targetId: request.targetId,
    })
  })
  ipcMain.handle(IPC.pluginsUninstall, async (_event, packageName: string) => {
    if (!isSafePackageName(packageName)) throw new Error('插件名称无效。')
    return installer.remove(packageName)
  })

  ipcMain.handle(IPC.skillsDiscover, async (_event, payload: { query: string; sort: DiscoverySort; page: number }) => {
    const sort: DiscoverySort = payload.sort === 'updated' ? 'updated' : 'stars'
    const page = Math.min(34, Math.max(1, Math.floor(Number(payload.page) || 1)))
    const found = await searchSkillRepositories(payload.query ?? '', sort, page)
    return { ...found, installedSkills: await installer.readInstalledSkills() }
  })
  ipcMain.handle(IPC.skillsAnalyze, async (_event, payload: { fullName: string; defaultBranch: string }) => {
    if (!isSafeRepositoryName(payload.fullName)) throw new Error('GitHub 仓库名称无效。')
    return installer.analyzeSkill(payload.fullName, payload.defaultBranch)
  })
  ipcMain.handle(IPC.skillsInstall, async (_event, request: SkillInstallRequest) => {
    if (!isSafeRepositoryName(request.repository)) throw new Error('GitHub 仓库名称无效。')
    return installer.installSkill(request)
  })
  ipcMain.handle(IPC.skillsReadInstalled, () => installer.readInstalledSkills())

  ipcMain.handle(IPC.aiStatus, () => aiInstaller.status())
  ipcMain.handle(IPC.aiHasSnapshot, () => aiInstaller.hasSnapshot())
  ipcMain.handle(IPC.aiInstall, async (_event, input: { repository: string; defaultBranch: string }) => {
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
