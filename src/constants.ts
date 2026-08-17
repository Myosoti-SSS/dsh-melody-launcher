// 主进程与渲染进程共享的常量。
// 与 types.ts 一样，这个文件是两侧的公共契约 —— 任何一侧单独持有副本都会随时间漂移。

/** DSH 本体的 GitHub 仓库。出现在插件列表中时按本体而非普通插件处理。 */
export const DSH_REPOSITORY = 'deepseek-ai/deepseek-harness'

/** 启动器自身的 GitHub 仓库。自更新检测以它的 Release 页为准。 */
export const LAUNCHER_REPOSITORY = 'rirko/dsh-melody-launcher'

/** DSH 本体的 npm 包名。检测与安装都以它为准。 */
export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh'

/** 未显式配置时使用的 Profile。 */
export const DEFAULT_PROFILE_NAME = 'web'

/** 渲染层保留的最大日志条数，超出后丢弃最旧的记录。 */
export const MAX_LOG_LINES = 500

/**
 * AI 尝试安装功能的开关。DSH ACP 相关包均为 rc 预览版，若接口漂移或出现问题，
 * 关掉这里即可隐藏入口，不影响普通安装。
 */
export const AI_INSTALL_ENABLED = true

/** 尚未取到主进程状态时的占位值。 */
export const EMPTY_RUNTIME_STATE = { running: false, pid: null, startedAt: null, url: null, port: null } as const
export const EMPTY_DSH_INSTALLATION = { installed: false, version: null, executable: null, source: null } as const

/**
 * IPC 通道名。主进程注册与 preload 调用共用这一份定义 ——
 * 此前两侧各写一遍字面量，改名时很容易只改一边。
 */
export const IPC = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  dshDetect: 'dsh:detect-installation',
  dshUpdateCheck: 'dsh:check-update',
  launcherUpdateCheck: 'launcher:update-check',
  launcherUpdateDownload: 'launcher:update-download',
  launcherUpdateApply: 'launcher:update-apply',
  credentialStatus: 'credentials:deepseek-status',
  credentialSet: 'credentials:deepseek-set',
  credentialClear: 'credentials:deepseek-clear',
  customApiList: 'custom-api:list',
  customApiSave: 'custom-api:save',
  customApiRemove: 'custom-api:remove',
  githubAuthStatus: 'github-auth:status',
  githubAuthTokenLogin: 'github-auth:token-login',
  githubAuthDeviceBegin: 'github-auth:device-begin',
  githubAuthDeviceComplete: 'github-auth:device-complete',
  githubAuthDeviceCancel: 'github-auth:device-cancel',
  githubAuthLogout: 'github-auth:logout',
  chooseDirectory: 'dialog:directory',
  profileRead: 'profile:read',
  profileToggle: 'profile:toggle',
  profileReorder: 'profile:reorder',
  catalogDiscover: 'catalog:discover',
  catalogAnalyze: 'catalog:analyze',
  catalogImportUrl: 'catalog:import-url',
  pluginsInstall: 'plugins:install',
  pluginsUninstall: 'plugins:uninstall',
  pluginsTrial: 'plugins:trial',
  pluginsTrialRead: 'plugins:trial-read',
  aiInstall: 'ai:install',
  aiAdaptPlugin: 'ai:adapt-plugin',
  aiRepairRuntime: 'ai:repair-runtime',
  aiApprove: 'ai:approve',
  aiCancel: 'ai:cancel',
  aiRollback: 'ai:rollback',
  aiStatus: 'ai:status',
  aiHasSnapshot: 'ai:has-snapshot',
  skillsInstall: 'skills:install',
  skillsReadInstalled: 'skills:read-installed',
  skillsToggle: 'skills:toggle',
  applicationsInstall: 'applications:install',
  applicationsReadInstalled: 'applications:read-installed',
  applicationsToggle: 'applications:toggle',
  applicationsUninstall: 'applications:uninstall',
  presetsInstall: 'presets:install',
  presetsReadInstalled: 'presets:read-installed',
  presetsToggle: 'presets:toggle',
  runtimeState: 'runtime:state',
  runtimeStart: 'runtime:start',
  runtimeStop: 'runtime:stop',
  packsList: 'packs:list',
  packsCreate: 'packs:create',
  packsAnalyzeImport: 'packs:analyze-import',
  packsImport: 'packs:import',
  packsExport: 'packs:export',
  packsPickFile: 'packs:pick-file',
  packsActivate: 'packs:activate',
  packsDeactivate: 'packs:deactivate',
  packsRemove: 'packs:remove',
  packsRollback: 'packs:rollback',
  packsHasSnapshot: 'packs:has-snapshot',
  packsAddPlugin: 'packs:add-plugin',
  packsAddPreset: 'packs:add-preset',
  packsRemoveItem: 'packs:remove-item',
  packsToggleItem: 'packs:toggle-item',
  packsTogglePreset: 'packs:toggle-preset',
  packsRemovePreset: 'packs:remove-preset',
  openExternal: 'shell:open-external',
  openPath: 'shell:open-path',
  windowSetMode: 'window:set-mode',
  windowClose: 'window:close',
} as const

/** 主进程主动推送给渲染层的事件通道。 */
export const IPC_EVENTS = {
  runtimeOutput: 'runtime:output',
  runtimeStateChanged: 'runtime:state-changed',
  catalogAnalysisProgress: 'catalog:analysis-progress',
  installProgress: 'plugins:install-progress',
  launcherUpdateProgress: 'launcher:update-progress',
  pluginTrialEvent: 'plugins:trial-event',
  aiInstallEvent: 'ai:install-event',
  packProgress: 'packs:progress',
} as const
