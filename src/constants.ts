// 主进程与渲染进程共享的常量。
// 与 types.ts 一样，这个文件是两侧的公共契约 —— 任何一侧单独持有副本都会随时间漂移。

/** DSH 本体的 GitHub 仓库。出现在插件列表中时按本体而非普通插件处理。 */
export const DSH_REPOSITORY = 'deepseek-ai/deepseek-harness'

/** DSH 本体的 npm 包名。检测与安装都以它为准。 */
export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh'

/** 未显式配置时使用的 Profile。 */
export const DEFAULT_PROFILE_NAME = 'web'

/** 渲染层保留的最大日志条数，超出后丢弃最旧的记录。 */
export const MAX_LOG_LINES = 500

/** 尚未取到主进程状态时的占位值。 */
export const EMPTY_RUNTIME_STATE = { running: false, pid: null, startedAt: null, url: null } as const
export const EMPTY_DSH_INSTALLATION = { installed: false, version: null, executable: null, source: null } as const

/**
 * IPC 通道名。主进程注册与 preload 调用共用这一份定义 ——
 * 此前两侧各写一遍字面量，改名时很容易只改一边。
 */
export const IPC = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  dshDetect: 'dsh:detect-installation',
  credentialStatus: 'credentials:deepseek-status',
  credentialSet: 'credentials:deepseek-set',
  credentialClear: 'credentials:deepseek-clear',
  chooseDirectory: 'dialog:directory',
  profileRead: 'profile:read',
  profileToggle: 'profile:toggle',
  profileReorder: 'profile:reorder',
  pluginsDiscover: 'plugins:discover',
  pluginsInstall: 'plugins:install',
  pluginsUninstall: 'plugins:uninstall',
  runtimeState: 'runtime:state',
  runtimeStart: 'runtime:start',
  runtimeStop: 'runtime:stop',
  openExternal: 'shell:open-external',
  openPath: 'shell:open-path',
  windowSetMode: 'window:set-mode',
  windowClose: 'window:close',
} as const

/** 主进程主动推送给渲染层的事件通道。 */
export const IPC_EVENTS = {
  runtimeOutput: 'runtime:output',
  runtimeStateChanged: 'runtime:state-changed',
  installProgress: 'plugins:install-progress',
} as const
