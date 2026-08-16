export type ViewName = 'plugins' | 'discover' | 'runtime' | 'packs'
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

export type PluginInstallSource = 'npm' | 'github' | 'archive-subdirectory' | 'local-directory'

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
  /** `local-directory` 源专用：本地插件本体所在目录（已存在的绝对路径）。 */
  localDirectory?: string
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
  profileName?: string // 安装到指定 profile
}

export interface DshInstallationStatus {
  installed: boolean
  version: string | null
  executable: string | null
  source: 'launcher' | 'system' | null
}

export interface DshUpdateStatus {
  state: 'not-installed' | 'up-to-date' | 'update-available' | 'error'
  localVersion: string | null
  remoteVersion: string | null
  repository: string
  checkedAt: string
  message: string
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

/** 从 GitHub 链接导入的结果：市场行 + 已完成的仓库分析。 */
export interface CatalogImportResult {
  repository: CatalogRepositoryResult
  analysis: CatalogRepositoryAnalysis
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
  channel: 'runtime' | 'plugin' | 'ai'
  level: 'info' | 'error' | 'success'
  text: string
  timestamp: string
}

export type AiInstallPhase = 'idle' | 'preparing' | 'running' | 'done' | 'cancelled' | 'error'

export interface AiInstallStatus {
  phase: AiInstallPhase
  repository: string | null
  startedAt: string | null
  sessionId: string | null
  message: string
}

/** 渲染层看到的待审批请求（args 已脱敏截断）。 */
export interface AiApprovalRequest {
  id: string
  toolName: string
  toolKind: string | null
  args: string
  reason: string
}

export type AiInstallEvent =
  | { kind: 'status'; status: AiInstallStatus }
  | { kind: 'log'; text: string }
  | { kind: 'auto-approved'; toolName: string; reason: string }
  | { kind: 'approval'; request: AiApprovalRequest }
  | { kind: 'snapshot'; snapshotId: string }
  | { kind: 'done'; message: string }
  | { kind: 'cancelled'; message: string }
  | { kind: 'error'; message: string }

export interface AiInstallResult {
  ok: boolean
  message: string
}

// ===================== 整合包（Pack）管理 =====================

export type PackSource = 'created' | 'zip' | 'manifest' | 'raw'

export interface PackPluginEntry {
  packageName: string
  repository?: string        // github 源
  source?: 'github' | 'npm' | 'local'
  subdirectory?: string
  commit?: string
  version?: string
}

export interface PackManifest {
  name: string
  description: string
  version: string
  author?: string
  plugins: PackPluginEntry[]
  skills?: unknown[]          // v1 预留，忽略
}

export interface PackAnalysisItem {
  packageName: string
  available: boolean          // 能否安装
  offline: boolean            // 插件本体是否在 zip 内（离线装）
  kind?: 'plugin' | 'skill'   // 缺省为插件；技能项的 packageName 即技能名
  reason?: string             // 不可装原因
}

export interface PackAnalysis {
  id: string                  // = pack-<safeName>
  name: string
  description: string
  version: string
  source: PackSource
  items: PackAnalysisItem[]
}

export interface PackInstalledPlugin {
  packageName: string
  enabled: boolean
  version?: string
}

/** raw 整合包导入的技能（全局安装，记入包以支持删包清理）。 */
export interface PackInstalledSkill {
  name: string
  format: 'bundle' | 'flat'
  enabled: boolean
  description?: string
}

export interface PackStatus {
  id: string
  name: string
  description: string
  version: string
  source: PackSource
  enabled: boolean            // 当前 profile 是否为它
  state: 'complete' | 'partial' | 'failed'
  plugins: PackInstalledPlugin[]
  skills?: PackInstalledSkill[]
  /** state 为 partial/failed 时的失败项（含原因），完整包缺省省略。 */
  failures?: { packageName: string; reason: string }[]
  installedAt: string
  updatedAt: string
}

export interface PackCreateRequest {
  name: string
  description?: string
  packageNames: string[]      // 从已安装插件勾选的包名
}

/** importPack 的可选覆盖项（raw 导入时的包名覆盖）。 */
export interface PackImportOptions {
  name?: string
}

export interface PackInstallResult {
  id: string
  installed: string[]
  failures: { packageName: string; reason: string }[]
  state: 'complete' | 'partial' | 'failed'
}

export type PackProgressEvent =
  | { kind: 'status'; message: string }
  | { kind: 'phase'; phase: string; itemIndex?: number; itemTotal?: number }
  | { kind: 'item-start'; packageName: string; offline: boolean }
  | { kind: 'item-done'; packageName: string; ok: boolean; reason?: string }
  | { kind: 'snapshot' }
  | { kind: 'done'; result: PackInstallResult }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

export interface LauncherApi {
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<AppSettings>
  detectDshInstallation(): Promise<DshInstallationStatus>
  checkDshUpdate(): Promise<DshUpdateStatus>
  getDeepSeekCredentialStatus(): Promise<CredentialStatus>
  setDeepSeekApiKey(apiKey: string): Promise<CredentialStatus>
  clearDeepSeekApiKey(): Promise<CredentialStatus>
  chooseDirectory(kind: 'dshInstallPath' | 'dshHome' | 'workspace'): Promise<string | null>
  readProfile(): Promise<ProfileState>
  togglePlugin(packageName: string, enabled: boolean, profileName?: string): Promise<ProfileState>
  reorderPlugins(packageNames: string[]): Promise<ProfileState>
  discoverCatalog(query: string, sort: 'stars' | 'updated', page: number): Promise<CatalogDiscoveryResult>
  analyzeCatalogRepository(fullName: string, defaultBranch: string): Promise<CatalogRepositoryAnalysis>
  importCatalogUrl(url: string): Promise<CatalogImportResult>
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
  aiInstall(input: { repository: string; defaultBranch: string }): Promise<AiInstallResult>
  aiApprove(requestId: string, allow: boolean): Promise<boolean>
  aiCancel(): Promise<void>
  aiRollback(): Promise<{ restored: number; profileName: string }>
  aiStatus(): Promise<AiInstallStatus>
  aiHasSnapshot(): Promise<boolean>
  listPacks(): Promise<PackStatus[]>
  createPack(request: PackCreateRequest): Promise<PackInstallResult>
  analyzePackImport(path: string): Promise<PackAnalysis>
  importPack(path: string, items?: string[], options?: PackImportOptions): Promise<PackInstallResult>
  exportPack(packId: string): Promise<string | null>
  pickPackFile(): Promise<string | null>
  activatePack(packId: string): Promise<AppSettings>
  deactivatePack(): Promise<AppSettings>
  removePack(packId: string): Promise<{ removed: number }>
  rollbackPack(): Promise<{ restored: number; profileName: string }>
  packHasSnapshot(): Promise<boolean>
  addPackPlugin(packId: string, packageName: string): Promise<PackStatus>
  togglePackItem(packId: string, packageName: string, enabled: boolean): Promise<PackStatus>
  removePackItem(packId: string, packageName: string): Promise<PackStatus>
  onPackProgress(listener: (event: PackProgressEvent) => void): () => void
  onRuntimeOutput(listener: (output: RuntimeOutput) => void): () => void
  onRuntimeState(listener: (state: RuntimeState) => void): () => void
  onInstallProgress(listener: (progress: InstallProgress) => void): () => void
  onAiInstallEvent(listener: (event: AiInstallEvent) => void): () => void
}

declare global {
  interface Window {
    launcher?: LauncherApi
  }
}
