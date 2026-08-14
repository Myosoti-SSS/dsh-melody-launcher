export type ViewName = 'plugins' | 'discover' | 'runtime'
export type WindowMode = 'launcher' | 'manager'

export interface AppSettings {
  dshHome: string
  profileName: string
  workspace: string
  launchExecutable: string
  launchArgs: string[]
  openAfterLaunch: boolean
}

export interface CredentialStatus {
  configured: boolean
}

export interface ManagedPlugin {
  packageName: string
  displayName: string
  version: string
  description: string
  repository?: string
  repositoryFullName?: string
  enabled: boolean
  builtin: boolean
  locked: boolean
  compatible: boolean
  order: number | null
}

export interface ProfileState {
  initialized: boolean
  profileDir: string
  manifestPath: string
  plugins: ManagedPlugin[]
  activeBundles: string[]
  dependencyCount: number
  disabledCount: number
}

export interface RepositoryResult {
  id: number
  fullName: string
  name: string
  owner: string
  description: string
  url: string
  stars: number
  language: string | null
  updatedAt: string
  topics: string[]
  defaultBranch: string
  kind: 'plugin' | 'dsh'
}

export interface DshInstallationStatus {
  installed: boolean
  version: string | null
  executable: string | null
  source: 'launcher' | 'system' | null
}

export interface DiscoveryResult {
  repositories: RepositoryResult[]
  totalCount: number
  rateRemaining?: number
  dshInstallation: DshInstallationStatus
}

export interface InstallProgress {
  repository: string
  kind: 'plugin' | 'dsh'
  phase: 'preparing' | 'resolving' | 'downloading' | 'configuring' | 'complete' | 'error'
  percent: number
  message: string
  indeterminate?: boolean
}

export interface RepositoryInstallResult {
  kind: 'plugin' | 'dsh'
  profile: ProfileState
  settings: AppSettings
  dshInstallation: DshInstallationStatus
}

export interface RuntimeState {
  running: boolean
  pid: number | null
  startedAt: string | null
  url: string | null
}

export interface RuntimeOutput {
  channel: 'runtime' | 'plugin'
  level: 'info' | 'error' | 'success'
  text: string
  timestamp: string
}

export interface LauncherApi {
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<AppSettings>
  detectDshInstallation(): Promise<DshInstallationStatus>
  getDeepSeekCredentialStatus(): Promise<CredentialStatus>
  setDeepSeekApiKey(apiKey: string): Promise<CredentialStatus>
  clearDeepSeekApiKey(): Promise<CredentialStatus>
  chooseDirectory(kind: 'dshHome' | 'workspace'): Promise<string | null>
  readProfile(): Promise<ProfileState>
  togglePlugin(packageName: string, enabled: boolean): Promise<ProfileState>
  reorderPlugins(packageNames: string[]): Promise<ProfileState>
  discoverPlugins(query: string, sort: 'stars' | 'updated'): Promise<DiscoveryResult>
  installPlugin(fullName: string): Promise<RepositoryInstallResult>
  uninstallPlugin(packageName: string): Promise<ProfileState>
  getRuntimeState(): Promise<RuntimeState>
  startRuntime(): Promise<RuntimeState>
  stopRuntime(): Promise<RuntimeState>
  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<void>
  setWindowMode(mode: WindowMode): Promise<void>
  closeWindow(): Promise<void>
  onRuntimeOutput(listener: (output: RuntimeOutput) => void): () => void
  onRuntimeState(listener: (state: RuntimeState) => void): () => void
  onInstallProgress(listener: (progress: InstallProgress) => void): () => void
}

declare global {
  interface Window {
    launcher?: LauncherApi
  }
}
