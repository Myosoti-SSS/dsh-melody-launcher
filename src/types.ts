export type ViewName = 'plugins' | 'discover' | 'skills' | 'runtime'
export type WindowMode = 'launcher' | 'manager'

export interface AppSettings {
  dshInstallPath: string
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

export type PluginInstallability = 'ready' | 'choice' | 'dynamic' | 'application' | 'invalid'

export type PluginInstallSource = 'npm' | 'github' | 'archive-subdirectory'

export interface PluginInstallTarget {
  id: string
  packageName: string
  version: string | null
  source: PluginInstallSource
  profileName: string
  platform: 'web' | 'terminal' | 'unknown'
  subdirectory: string | null
  commit: string
  requiresBuild: boolean
  buildScripts: string[]
  nodeRange: string | null
}

export interface RepositoryAnalysis {
  repository: string
  defaultBranch: string
  installability: PluginInstallability
  summary: string
  targets: PluginInstallTarget[]
}

export interface PluginInstallRequest {
  repository: string
  defaultBranch: string
  targetId: string
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
  installedRepositories: string[]
}

export interface SkillRepositoryResult {
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
}

export interface SkillInstallTarget {
  id: string
  name: string
  description: string
  sourcePath: string
  format: 'bundle' | 'flat'
  revision: string
  modelInvocable: boolean
  userInvocable: boolean
}

export interface SkillRepositoryAnalysis {
  repository: string
  defaultBranch: string
  installability: 'ready' | 'choice' | 'invalid'
  summary: string
  targets: SkillInstallTarget[]
}

export interface InstalledSkill {
  name: string
  description: string
  path: string
  format: 'bundle' | 'flat'
  modelInvocable: boolean
  userInvocable: boolean
}

export interface SkillDiscoveryResult {
  repositories: SkillRepositoryResult[]
  totalCount: number
  rateRemaining?: number
  installedSkills: InstalledSkill[]
}

export interface SkillInstallRequest {
  repository: string
  defaultBranch: string
  targetId: string
}

export interface SkillInstallResult {
  installedSkill: InstalledSkill
  installedSkills: InstalledSkill[]
}

export interface InstallProgress {
  repository: string
  kind: 'plugin' | 'dsh' | 'skill'
  phase: 'preparing' | 'resolving' | 'downloading' | 'building' | 'configuring' | 'verifying' | 'complete' | 'error'
  percent: number
  message: string
  indeterminate?: boolean
}

export interface RepositoryInstallResult {
  kind: 'plugin' | 'dsh'
  profile: ProfileState
  settings: AppSettings
  dshInstallation: DshInstallationStatus
  installedProfileName?: string
  packageName?: string
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
  chooseDirectory(kind: 'dshInstallPath' | 'dshHome' | 'workspace'): Promise<string | null>
  readProfile(): Promise<ProfileState>
  togglePlugin(packageName: string, enabled: boolean): Promise<ProfileState>
  reorderPlugins(packageNames: string[]): Promise<ProfileState>
  discoverPlugins(query: string, sort: 'stars' | 'updated'): Promise<DiscoveryResult>
  analyzePlugin(fullName: string, defaultBranch: string): Promise<RepositoryAnalysis>
  installPlugin(request: string | PluginInstallRequest): Promise<RepositoryInstallResult>
  uninstallPlugin(packageName: string): Promise<ProfileState>
  discoverSkills(query: string, sort: 'stars' | 'updated'): Promise<SkillDiscoveryResult>
  analyzeSkill(fullName: string, defaultBranch: string): Promise<SkillRepositoryAnalysis>
  installSkill(request: SkillInstallRequest): Promise<SkillInstallResult>
  readInstalledSkills(): Promise<InstalledSkill[]>
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
