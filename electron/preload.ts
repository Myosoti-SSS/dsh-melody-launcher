import { contextBridge, ipcRenderer } from 'electron'
import { IPC, IPC_EVENTS } from '../src/constants'
import type {
  AiInstallEvent,
  AppSettings,
  InstallProgress,
  LauncherApi,
  LauncherUpdateProgress,
  PackProgressEvent,
  PluginTrialResult,
  RuntimeOutput,
  RuntimeState,
  WindowMode,
} from '../src/types'

/**
 * 渲染层与主进程之间唯一的桥。
 * 通道名来自共享常量，与主进程的注册面是同一份定义。
 */

/** 订阅一个主进程推送的事件，返回退订函数。 */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: LauncherApi = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke(IPC.settingsSave, settings),
  detectDshInstallation: () => ipcRenderer.invoke(IPC.dshDetect),
  checkDshUpdate: () => ipcRenderer.invoke(IPC.dshUpdateCheck),
  checkLauncherUpdate: () => ipcRenderer.invoke(IPC.launcherUpdateCheck),
  downloadLauncherUpdate: () => ipcRenderer.invoke(IPC.launcherUpdateDownload),
  applyLauncherUpdate: () => ipcRenderer.invoke(IPC.launcherUpdateApply),
  getDeepSeekCredentialStatus: () => ipcRenderer.invoke(IPC.credentialStatus),
  setDeepSeekApiKey: apiKey => ipcRenderer.invoke(IPC.credentialSet, apiKey),
  clearDeepSeekApiKey: () => ipcRenderer.invoke(IPC.credentialClear),
  getGitHubAuthStatus: () => ipcRenderer.invoke(IPC.githubAuthStatus),
  loginGitHubWithToken: token => ipcRenderer.invoke(IPC.githubAuthTokenLogin, token),
  beginGitHubDeviceLogin: () => ipcRenderer.invoke(IPC.githubAuthDeviceBegin),
  completeGitHubDeviceLogin: () => ipcRenderer.invoke(IPC.githubAuthDeviceComplete),
  cancelGitHubDeviceLogin: () => ipcRenderer.invoke(IPC.githubAuthDeviceCancel),
  logoutGitHub: () => ipcRenderer.invoke(IPC.githubAuthLogout),
  chooseDirectory: kind => ipcRenderer.invoke(IPC.chooseDirectory, kind),
  readProfile: () => ipcRenderer.invoke(IPC.profileRead),
  togglePlugin: (packageName, enabled) => ipcRenderer.invoke(IPC.profileToggle, { packageName, enabled }),
  reorderPlugins: packageNames => ipcRenderer.invoke(IPC.profileReorder, packageNames),
  discoverCatalog: (query, sort, page) => ipcRenderer.invoke(IPC.catalogDiscover, { query, sort, page }),
  analyzeCatalogRepository: (fullName, defaultBranch) => ipcRenderer.invoke(IPC.catalogAnalyze, { fullName, defaultBranch }),
  importCatalogUrl: url => ipcRenderer.invoke(IPC.catalogImportUrl, { url }),
  installPlugin: request => ipcRenderer.invoke(IPC.pluginsInstall, request),
  uninstallPlugin: packageName => ipcRenderer.invoke(IPC.pluginsUninstall, packageName),
  trialPlugin: (packageName, profileName) => ipcRenderer.invoke(IPC.pluginsTrial, { packageName, profileName }),
  readPluginTrials: () => ipcRenderer.invoke(IPC.pluginsTrialRead),
  installSkill: request => ipcRenderer.invoke(IPC.skillsInstall, request),
  readInstalledSkills: () => ipcRenderer.invoke(IPC.skillsReadInstalled),
  toggleSkill: (name, enabled) => ipcRenderer.invoke(IPC.skillsToggle, { name, enabled }),
  installPreset: request => ipcRenderer.invoke(IPC.presetsInstall, request),
  readInstalledPresets: () => ipcRenderer.invoke(IPC.presetsReadInstalled),
  togglePreset: (name, enabled) => ipcRenderer.invoke(IPC.presetsToggle, { name, enabled }),
  getRuntimeState: () => ipcRenderer.invoke(IPC.runtimeState),
  startRuntime: () => ipcRenderer.invoke(IPC.runtimeStart),
  stopRuntime: () => ipcRenderer.invoke(IPC.runtimeStop),
  openExternal: url => ipcRenderer.invoke(IPC.openExternal, url),
  openPath: path => ipcRenderer.invoke(IPC.openPath, path),
  setWindowMode: (mode: WindowMode) => ipcRenderer.invoke(IPC.windowSetMode, mode),
  closeWindow: () => ipcRenderer.invoke(IPC.windowClose),
  aiInstall: input => ipcRenderer.invoke(IPC.aiInstall, input),
  aiAdaptPlugin: input => ipcRenderer.invoke(IPC.aiAdaptPlugin, input),
  aiRepairRuntime: () => ipcRenderer.invoke(IPC.aiRepairRuntime),
  aiApprove: (requestId, allow) => ipcRenderer.invoke(IPC.aiApprove, requestId, allow),
  aiCancel: () => ipcRenderer.invoke(IPC.aiCancel),
  aiRollback: () => ipcRenderer.invoke(IPC.aiRollback),
  aiStatus: () => ipcRenderer.invoke(IPC.aiStatus),
  aiHasSnapshot: () => ipcRenderer.invoke(IPC.aiHasSnapshot),
  listPacks: () => ipcRenderer.invoke(IPC.packsList),
  createPack: request => ipcRenderer.invoke(IPC.packsCreate, request),
  analyzePackImport: path => ipcRenderer.invoke(IPC.packsAnalyzeImport, path),
  importPack: (path, items, options) => ipcRenderer.invoke(IPC.packsImport, path, items, options?.name),
  exportPack: packId => ipcRenderer.invoke(IPC.packsExport, packId),
  pickPackFile: () => ipcRenderer.invoke(IPC.packsPickFile),
  activatePack: packId => ipcRenderer.invoke(IPC.packsActivate, packId),
  deactivatePack: () => ipcRenderer.invoke(IPC.packsDeactivate),
  removePack: packId => ipcRenderer.invoke(IPC.packsRemove, packId),
  rollbackPack: () => ipcRenderer.invoke(IPC.packsRollback),
  packHasSnapshot: () => ipcRenderer.invoke(IPC.packsHasSnapshot),
  addPackPlugin: (packId, packageName) => ipcRenderer.invoke(IPC.packsAddPlugin, { packId, packageName }),
  togglePackItem: (packId, packageName, enabled) => ipcRenderer.invoke(IPC.packsToggleItem, { packId, packageName, enabled }),
  removePackItem: (packId, packageName) => ipcRenderer.invoke(IPC.packsRemoveItem, { packId, packageName }),
  onPackProgress: listener => subscribe<PackProgressEvent>(IPC_EVENTS.packProgress, listener),
  onRuntimeOutput: listener => subscribe<RuntimeOutput>(IPC_EVENTS.runtimeOutput, listener),
  onRuntimeState: listener => subscribe<RuntimeState>(IPC_EVENTS.runtimeStateChanged, listener),
  onInstallProgress: listener => subscribe<InstallProgress>(IPC_EVENTS.installProgress, listener),
  onLauncherUpdateProgress: listener => subscribe<LauncherUpdateProgress>(IPC_EVENTS.launcherUpdateProgress, listener),
  onPluginTrialEvent: listener => subscribe<PluginTrialResult>(IPC_EVENTS.pluginTrialEvent, listener),
  onAiInstallEvent: listener => subscribe<AiInstallEvent>(IPC_EVENTS.aiInstallEvent, listener),
}

contextBridge.exposeInMainWorld('launcher', api)
