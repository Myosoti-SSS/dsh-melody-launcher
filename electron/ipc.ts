import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { IPC } from '../src/constants'
import type { AppSettings, WindowMode } from '../src/types'
import { isWindowMode } from './app-window'
import { clearDeepSeekApiKey, getDeepSeekCredentialStatus, setDeepSeekApiKey } from './credentials'
import { searchPluginRepositories, type DiscoverySort } from './discovery'
import type { Installer } from './installer'
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
  getWindow: () => BrowserWindow | null
  setWindowMode: (mode: WindowMode) => void
}

export function registerIpcHandlers(deps: IpcDependencies): void {
  const { settings, runtime, installer } = deps

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

  ipcMain.handle(IPC.chooseDirectory, async (_event, kind: 'dshHome' | 'workspace') => {
    const window = deps.getWindow()
    if (!window) return null
    const current = await settings.read()
    const result = await dialog.showOpenDialog(window, {
      defaultPath: kind === 'dshHome' ? current.dshHome : current.workspace,
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

  ipcMain.handle(IPC.pluginsDiscover, async (_event, payload: { query: string; sort: DiscoverySort }) => {
    const sort: DiscoverySort = payload.sort === 'updated' ? 'updated' : 'stars'
    const found = await searchPluginRepositories(payload.query ?? '', sort)
    return { ...found, dshInstallation: await installer.detectDsh() }
  })
  ipcMain.handle(IPC.pluginsInstall, async (_event, fullName: string) => {
    if (!isSafeRepositoryName(fullName)) throw new Error('GitHub 仓库名称无效。')
    return installer.install(fullName)
  })
  ipcMain.handle(IPC.pluginsUninstall, async (_event, packageName: string) => {
    if (!isSafePackageName(packageName)) throw new Error('插件名称无效。')
    return installer.remove(packageName)
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
