export type ViewName = 'plugins' | 'discover' | 'runtime'
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

export type CatalogCandidateType = 'plugin' | 'skill'
export type CatalogKind = 'plugin' | 'skill' | 'hybrid' | 'dsh' | 'invalid'

export interface CatalogRepositoryResult {
  id: number
  fullName: string
  name: string
  owner: string
  description: string
  url: string
  stars: number
  /** GitHub Search API reports repository size in kilobytes. */
  sizeKb?: number
  language: string | null
  updatedAt: string
  topics: string[]
  defaultBranch: string
  kind: 'repository' | 'dsh'
  candidateTypes: CatalogCandidateType[]
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
  enabled: boolean
  modelInvocable: boolean
  userInvocable: boolean
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

export interface CatalogRepositoryAnalysis {
  repository: string
  defaultBranch: string
  kind: CatalogKind
  summary: string
  pluginAnalysis: RepositoryAnalysis | null
  skillAnalysis: SkillRepositoryAnalysis | null
  warnings: string[]
}

export interface CatalogDiscoveryResult {
  repositories: CatalogRepositoryResult[]
  topicTotals: Record<CatalogCandidateType, number>
  page: number
  pageCount: number
  rateRemaining?: number
  warnings: string[]
  dshInstallation: DshInstallationStatus
  installedRepositories: string[]
  installedSkills: InstalledSkill[]
}

export interface InstallProgress {
  repository: string
  kind: 'plugin' | 'dsh' | 'skill'
  phase: 'preparing' | 'resolving' | 'downloading' | 'building' | 'configuring' | 'verifying' | 'complete' | 'error'
  percent: number
  message: string
  indeterminate?: boolean
  downloadedBytes?: number
  totalBytes?: number
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
  discoverCatalog(query: string, sort: 'stars' | 'updated', page: number): Promise<CatalogDiscoveryResult>
  analyzeCatalogRepository(fullName: string, defaultBranch: string): Promise<CatalogRepositoryAnalysis>
  installPlugin(request: string | PluginInstallRequest): Promise<RepositoryInstallResult>
  uninstallPlugin(packageName: string): Promise<ProfileState>
  installSkill(request: SkillInstallRequest): Promise<SkillInstallResult>
  readInstalledSkills(): Promise<InstalledSkill[]>
  toggleSkill(name: string, enabled: boolean): Promise<InstalledSkill[]>
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
