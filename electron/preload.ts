import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, InstallProgress, LauncherApi, RuntimeOutput, RuntimeState, WindowMode } from '../src/types'

const api: LauncherApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  getDeepSeekCredentialStatus: () => ipcRenderer.invoke('credentials:deepseek-status'),
  setDeepSeekApiKey: apiKey => ipcRenderer.invoke('credentials:deepseek-set', apiKey),
  clearDeepSeekApiKey: () => ipcRenderer.invoke('credentials:deepseek-clear'),
  chooseDirectory: kind => ipcRenderer.invoke('dialog:directory', kind),
  readProfile: () => ipcRenderer.invoke('profile:read'),
  togglePlugin: (packageName, enabled) => ipcRenderer.invoke('profile:toggle', { packageName, enabled }),
  reorderPlugins: packageNames => ipcRenderer.invoke('profile:reorder', packageNames),
  discoverPlugins: (query, sort) => ipcRenderer.invoke('plugins:discover', { query, sort }),
  installPlugin: fullName => ipcRenderer.invoke('plugins:install', fullName),
  uninstallPlugin: packageName => ipcRenderer.invoke('plugins:uninstall', packageName),
  getRuntimeState: () => ipcRenderer.invoke('runtime:state'),
  startRuntime: () => ipcRenderer.invoke('runtime:start'),
  stopRuntime: () => ipcRenderer.invoke('runtime:stop'),
  openExternal: url => ipcRenderer.invoke('shell:open-external', url),
  openPath: path => ipcRenderer.invoke('shell:open-path', path),
  setWindowMode: (mode: WindowMode) => ipcRenderer.invoke('window:set-mode', mode),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onRuntimeOutput: listener => {
    const wrapped = (_event: Electron.IpcRendererEvent, output: RuntimeOutput) => listener(output)
    ipcRenderer.on('runtime:output', wrapped)
    return () => ipcRenderer.removeListener('runtime:output', wrapped)
  },
  onRuntimeState: listener => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: RuntimeState) => listener(state)
    ipcRenderer.on('runtime:state-changed', wrapped)
    return () => ipcRenderer.removeListener('runtime:state-changed', wrapped)
  },
  onInstallProgress: listener => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: InstallProgress) => listener(progress)
    ipcRenderer.on('plugins:install-progress', wrapped)
    return () => ipcRenderer.removeListener('plugins:install-progress', wrapped)
  },
}

contextBridge.exposeInMainWorld('launcher', api)
