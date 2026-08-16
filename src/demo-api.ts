import type {
  AiInstallEvent,
  AiInstallStatus,
  AppSettings,
  CatalogDiscoveryResult,
  CatalogRepositoryAnalysis,
  CatalogRepositoryResult,
  CredentialStatus,
  DshInstallationStatus,
  DshUpdateStatus,
  InstallProgress,
  InstalledSkill,
  LauncherApi,
  ManagedPlugin,
  ProfileState,
  RepositoryAnalysis,
  RuntimeOutput,
  RuntimeState,
  SkillRepositoryAnalysis,
} from './types'

let demoSettings: AppSettings = {
  dshInstallPath: 'C:\\Users\\demo\\AppData\\Roaming\\dsh-launcher\\dsh-runtime',
  dshHome: 'C:\\Users\\demo\\.dsh',
  profileName: 'web',
  workspace: 'C:\\Users\\demo\\Projects',
  launchExecutable: 'C:\\Program Files\\nodejs\\npx.cmd',
  launchArgs: ['--yes', '@deepseek-ai/dsh', 'web'],
  openAfterLaunch: true,
}

let demoPlugins: ManagedPlugin[] = [
  {
    packageName: '@deepseek-ai/dsh-base',
    displayName: 'Base runtime',
    version: '随 DSH 提供',
    description: 'DeepSeek Harness 的核心服务、模型和工具组合层。',
    enabled: true,
    builtin: true,
    locked: true,
    compatible: true,
    order: 1,
  },
  {
    packageName: '@deepseek-ai/dsh-web-app',
    displayName: 'Web app',
    version: '随 DSH 提供',
    description: '浏览器工作台与 Web 运行时组合层。',
    enabled: true,
    builtin: true,
    locked: true,
    compatible: true,
    order: 2,
  },
  {
    packageName: '@zhu1090093659/dsh-web-ui',
    displayName: 'Web UI collection',
    version: '1.7.2',
    description: '任务看板、Git 图谱、右侧面板、移动端与实时 token 统计。',
    repository: 'https://github.com/zhu1090093659/dsh-web-ui',
    repositoryFullName: 'zhu1090093659/dsh-web-ui',
    enabled: true,
    builtin: false,
    locked: false,
    compatible: true,
    order: 3,
  },
  {
    packageName: '@liustack/modlens',
    displayName: 'ModLens',
    version: '0.9.4',
    description: '为纯文本智能体提供 OCR、布局和图像语义证据。',
    repository: 'https://github.com/liustack/modlens',
    repositoryFullName: 'liustack/modlens',
    enabled: true,
    builtin: false,
    locked: false,
    compatible: true,
    order: 4,
  },
  {
    packageName: '@deepseek-harness-tui/dsh-tui',
    displayName: 'DSH TUI',
    version: '2.3.0',
    description: 'Claude Code 风格的全屏终端交互界面。',
    repository: 'https://github.com/ccch1mneyyy/dsh-TUI',
    repositoryFullName: 'ccch1mneyyy/dsh-TUI',
    enabled: false,
    builtin: false,
    locked: false,
    compatible: true,
    order: null,
  },
]

const demoRepositories: CatalogRepositoryResult[] = [
  { id: 0, fullName: 'deepseek-ai/deepseek-harness', name: 'deepseek-harness', owner: 'deepseek-ai', description: 'DeepSeek Harness 官方本体。', url: 'https://github.com/deepseek-ai/deepseek-harness', stars: 71883, language: 'TypeScript', updatedAt: '2026-08-14T05:20:00Z', topics: ['dsh-plugin', 'dsh', 'cordis'], defaultBranch: 'master', kind: 'dsh', candidateTypes: [] },
  { id: 1, fullName: 'zhu1090093659/dsh-web-ui', name: 'dsh-web-ui', owner: 'zhu1090093659', description: 'Plugin and skin collection for DeepSeek Harness Web UI.', url: 'https://github.com/zhu1090093659/dsh-web-ui', stars: 863, language: 'TypeScript', updatedAt: '2026-08-14T03:20:00Z', topics: ['dsh-plugin', 'web-ui', 'deepseek-harness'], defaultBranch: 'main', kind: 'repository', candidateTypes: ['plugin'] },
  { id: 2, fullName: 'liustack/modlens', name: 'modlens', owner: 'liustack', description: 'The first vision plugin for DeepSeek Harness.', url: 'https://github.com/liustack/modlens', stars: 829, language: 'TypeScript', updatedAt: '2026-08-14T02:10:00Z', topics: ['dsh-plugin', 'vision', 'ocr'], defaultBranch: 'main', kind: 'repository', candidateTypes: ['plugin'] },
  { id: 3, fullName: 'ccch1mneyyy/dsh-TUI', name: 'dsh-TUI', owner: 'ccch1mneyyy', description: 'Claude Code 风格全屏交互终端插件。', url: 'https://github.com/ccch1mneyyy/dsh-TUI', stars: 443, language: 'TypeScript', updatedAt: '2026-08-14T04:10:00Z', topics: ['dsh-plugin', 'tui', 'terminal'], defaultBranch: 'main', kind: 'repository', candidateTypes: ['plugin'] },
  { id: 4, fullName: 'omdsh-dev/DSH-better-sidebar', name: 'DSH-better-sidebar', owner: 'omdsh-dev', description: '支持文件、终端、Git 和子代理的侧边栏工作台。', url: 'https://github.com/omdsh-dev/DSH-better-sidebar', stars: 337, language: 'TypeScript', updatedAt: '2026-08-13T21:30:00Z', topics: ['dsh-plugin', 'sidebar'], defaultBranch: 'main', kind: 'repository', candidateTypes: ['plugin'] },
  { id: 101, fullName: 'TohsakaRIN521/dsh-academic-skill', name: 'dsh-academic-skill', owner: 'TohsakaRIN521', description: 'Academic writing and verification skills for DSH.', url: 'https://github.com/TohsakaRIN521/dsh-academic-skill', stars: 210, language: 'Python', updatedAt: '2026-08-15T03:20:00Z', topics: ['dsh-skill', 'academic'], defaultBranch: 'main', kind: 'repository', candidateTypes: ['skill'] },
  { id: 102, fullName: 'v587d/dsh-multimodal-skill', name: 'dsh-multimodal-skill', owner: 'v587d', description: 'Multimodal image and audio workflows.', url: 'https://github.com/v587d/dsh-multimodal-skill', stars: 96, language: 'Python', updatedAt: '2026-08-14T23:10:00Z', topics: ['dsh-skill', 'multimodal'], defaultBranch: 'main', kind: 'repository', candidateTypes: ['skill'] },
  { id: 103, fullName: '2BingLing/dsh-market', name: 'dsh-market', owner: '2BingLing', description: '同时提供 Plugin 与 Skill 的 DSH 生态市场。', url: 'https://github.com/2BingLing/dsh-market', stars: 350, language: 'TypeScript', updatedAt: '2026-08-15T02:10:00Z', topics: ['dsh-plugin', 'dsh-skill', 'market'], defaultBranch: 'master', kind: 'repository', candidateTypes: ['plugin', 'skill'] },
  { id: 104, fullName: 'nexu-io/open-design', name: 'open-design', owner: 'nexu-io', description: '普通应用仓库，用于演示错误 topic 的无效候选。', url: 'https://github.com/nexu-io/open-design', stars: 28, sizeKb: 1_788_202, language: 'TypeScript', updatedAt: '2026-08-13T12:10:00Z', topics: ['dsh-plugin'], defaultBranch: 'main', kind: 'repository', candidateTypes: ['plugin'] },
]

let demoInstalledSkills: InstalledSkill[] = []

let demoRuntime: RuntimeState = { running: false, pid: null, startedAt: null, url: null }
let demoCredential: CredentialStatus = { configured: false }
let demoDshInstallation: DshInstallationStatus = { installed: false, version: null, executable: null, source: null }
const demoRemoteDshVersion = '0.1.0-rc.7'
const outputListeners = new Set<(output: RuntimeOutput) => void>()
const stateListeners = new Set<(state: RuntimeState) => void>()
const installProgressListeners = new Set<(progress: InstallProgress) => void>()
const aiEventListeners = new Set<(event: AiInstallEvent) => void>()
let demoAiStatus: AiInstallStatus = { phase: 'idle', repository: null, startedAt: null, sessionId: null, message: '' }
let demoAiResolve: ((allow: boolean) => void) | null = null
let demoAiCancelled = false

function emitAiEvent(event: AiInstallEvent): void {
  aiEventListeners.forEach(listener => listener(event))
}

function setDemoAiStatus(partial: Partial<AiInstallStatus>): void {
  demoAiStatus = { ...demoAiStatus, ...partial }
  emitAiEvent({ kind: 'status', status: demoAiStatus })
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds))
}

function profile(): ProfileState {
  return {
    initialized: true,
    profileDir: `${demoSettings.dshHome}\\profiles\\${demoSettings.profileName}`,
    manifestPath: `${demoSettings.dshHome}\\profiles\\${demoSettings.profileName}\\package.json`,
    plugins: demoPlugins,
    activeBundles: demoPlugins.filter(plugin => plugin.enabled).map(plugin => plugin.packageName),
    dependencyCount: demoPlugins.filter(plugin => !plugin.builtin).length,
    disabledCount: demoPlugins.filter(plugin => !plugin.enabled).length,
  }
}

function renumber(plugins: ManagedPlugin[]): ManagedPlugin[] {
  let order = 0
  return plugins.map(plugin => ({ ...plugin, order: plugin.enabled ? ++order : null }))
}

function demoAnalysis(fullName: string, defaultBranch: string): RepositoryAnalysis {
  const repo = demoRepositories.find(item => item.fullName === fullName)
  if (fullName === 'nexu-io/open-design') {
    return { repository: fullName, defaultBranch, installability: 'application', summary: '这是独立应用，不是可加载的 DSH Plugin。', targets: [] }
  }
  if (repo?.candidateTypes.length === 1 && repo.candidateTypes[0] === 'skill') {
    return { repository: fullName, defaultBranch, installability: 'invalid', summary: '没有找到 Cordis Bundle 清单。', targets: [] }
  }
  const packageName = fullName === 'liustack/modlens'
    ? '@liustack/modlens'
    : fullName === 'ccch1mneyyy/dsh-TUI'
      ? '@deepseek-harness-tui/dsh-tui'
      : fullName === 'omdsh-dev/DSH-better-sidebar'
        ? 'dsh-better-sidebar'
        : `@${repo?.owner ?? 'demo'}/${(repo?.name ?? 'plugin').toLowerCase()}`
  return {
    repository: fullName,
    defaultBranch,
    installability: 'ready',
    summary: `检测到可安装的 ${packageName}。`,
    targets: [{
      id: `${packageName}:.`,
      packageName,
      version: '1.0.0',
      source: 'npm',
      profileName: packageName === '@deepseek-harness-tui/dsh-tui' ? 'cc-tui' : 'web',
      platform: packageName === '@deepseek-harness-tui/dsh-tui' ? 'terminal' : 'web',
      subdirectory: null,
      commit: 'a'.repeat(40),
      requiresBuild: false,
      buildScripts: [],
      nodeRange: '>=22.19',
    }],
  }
}

function demoSkillAnalysis(fullName: string, defaultBranch: string): SkillRepositoryAnalysis {
  const repo = demoRepositories.find(item => item.fullName === fullName)
  if (!repo?.candidateTypes.includes('skill')) {
    return { repository: fullName, defaultBranch, installability: 'invalid', summary: '没有找到符合 DSH 规范的 SKILL.md 或单文件 Skill。', targets: [] }
  }
  const names = fullName.includes('academic')
    ? ['academic-paper-completion', 'skill-optimizer']
    : fullName === '2BingLing/dsh-market'
      ? ['dsh-market-guide']
      : ['multimodal-workflow']
  return {
    repository: fullName,
    defaultBranch,
    installability: names.length > 1 ? 'choice' : 'ready',
    summary: names.length > 1 ? `确认包含 ${names.length} 个有效 DSH Skills。` : `确认是 DSH Skill：${names[0]}`,
    targets: names.map(name => ({
      id: `${name}:${name}/SKILL.md`,
      name,
      description: `Reusable instructions for ${name}.`,
      sourcePath: `${name}/SKILL.md`,
      format: 'bundle',
      revision: defaultBranch,
      modelInvocable: true,
      userInvocable: true,
    })),
  }
}

function demoCatalogAnalysis(fullName: string, defaultBranch: string): CatalogRepositoryAnalysis {
  if (fullName === 'deepseek-ai/deepseek-harness') {
    return {
      repository: fullName,
      defaultBranch,
      kind: 'dsh',
      summary: '这是 DeepSeek Harness 官方仓库，将作为 DSH 本体安装。',
      pluginAnalysis: null,
      skillAnalysis: null,
      warnings: [],
    }
  }
  const pluginAnalysis = demoAnalysis(fullName, defaultBranch)
  const skillAnalysis = demoSkillAnalysis(fullName, defaultBranch)
  const plugin = ['ready', 'choice', 'dynamic'].includes(pluginAnalysis.installability)
  const skill = ['ready', 'choice'].includes(skillAnalysis.installability)
  const kind = plugin && skill ? 'hybrid' : plugin ? 'plugin' : skill ? 'skill' : 'invalid'
  return {
    repository: fullName,
    defaultBranch,
    kind,
    summary: kind === 'hybrid'
      ? `确认包含 ${pluginAnalysis.targets.length} 个 Plugin 组件和 ${skillAnalysis.targets.length} 个 Skill 组件。`
      : kind === 'plugin'
        ? pluginAnalysis.summary
        : kind === 'skill'
          ? skillAnalysis.summary
          : '没有找到符合 DSH 规范的 Plugin 或 Skill 组件。',
    pluginAnalysis,
    skillAnalysis,
    warnings: [],
  }
}

export const demoApi: LauncherApi = {
  getSettings: async () => demoSettings,
  saveSettings: async settings => (demoSettings = settings),
  detectDshInstallation: async () => ({ ...demoDshInstallation }),
  checkDshUpdate: async (): Promise<DshUpdateStatus> => {
    const localVersion = demoDshInstallation.version
    if (!demoDshInstallation.installed || !localVersion) {
      return {
        state: 'not-installed',
        localVersion,
        remoteVersion: null,
        repository: 'deepseek-ai/deepseek-harness',
        checkedAt: new Date().toISOString(),
        message: '尚未安装 DSH。',
      }
    }
    const available = localVersion !== demoRemoteDshVersion
    return {
      state: available ? 'update-available' : 'up-to-date',
      localVersion,
      remoteVersion: demoRemoteDshVersion,
      repository: 'deepseek-ai/deepseek-harness',
      checkedAt: new Date().toISOString(),
      message: available ? `发现 DSH 新版本 ${demoRemoteDshVersion}。` : '当前 DSH 已是最新版本。',
    }
  },
  getDeepSeekCredentialStatus: async () => demoCredential,
  setDeepSeekApiKey: async apiKey => {
    if (!apiKey.trim()) throw new Error('API Key 不能为空。')
    demoCredential = { configured: true }
    return demoCredential
  },
  clearDeepSeekApiKey: async () => {
    demoCredential = { configured: false }
    return demoCredential
  },
  chooseDirectory: async kind => kind === 'dshInstallPath'
    ? 'D:\\DeepSeek Harness'
    : kind === 'dshHome'
      ? 'C:\\Users\\demo\\.dsh'
      : 'C:\\Users\\demo\\Projects',
  readProfile: async () => profile(),
  togglePlugin: async (packageName, enabled) => {
    demoPlugins = renumber(demoPlugins.map(plugin => plugin.packageName === packageName ? { ...plugin, enabled } : plugin))
    return profile()
  },
  reorderPlugins: async packageNames => {
    const active = packageNames.map(name => demoPlugins.find(plugin => plugin.packageName === name)!).filter(Boolean)
    const inactive = demoPlugins.filter(plugin => !plugin.enabled)
    demoPlugins = renumber([...active, ...inactive])
    return profile()
  },
  discoverCatalog: async (query, sort, page): Promise<CatalogDiscoveryResult> => {
    const needle = query.trim().toLowerCase()
    const matchingRepositories = demoRepositories
      .filter(repo => !needle || `${repo.fullName} ${repo.description}`.toLowerCase().includes(needle))
      .sort((a, b) => sort === 'stars' ? b.stars - a.stars : b.updatedAt.localeCompare(a.updatedAt))
    const start = (Math.max(1, page) - 1) * 30
    const repositories = matchingRepositories.slice(start, start + 30)
    return {
      repositories,
      topicTotals: { plugin: 3_257, skill: 15 },
      page: Math.max(1, page),
      pageCount: 67,
      rateRemaining: 9,
      warnings: [],
      dshInstallation: demoDshInstallation,
      installedRepositories: demoPlugins.map(plugin => plugin.repositoryFullName).filter((value): value is string => Boolean(value)),
      installedSkills: demoInstalledSkills,
    }
  },
  analyzeCatalogRepository: async (fullName, defaultBranch) => demoCatalogAnalysis(fullName, defaultBranch),
  installPlugin: async request => {
    const fullName = typeof request === 'string' ? request : request.repository
    const repo = demoRepositories.find(item => item.fullName === fullName)
    const kind = repo?.kind === 'dsh' ? 'dsh' : 'plugin'
    installProgressListeners.forEach(listener => listener({ repository: fullName, kind, phase: 'resolving', percent: 18, message: kind === 'dsh' ? '正在解析 DSH 安装包' : '正在解析插件仓库' }))
    await wait(350)
    installProgressListeners.forEach(listener => listener({ repository: fullName, kind, phase: 'downloading', percent: 28, message: kind === 'dsh' ? '正在下载并安装 DSH' : '正在下载并安装插件', indeterminate: true, downloadedBytes: 19_341_312 }))
    await wait(900)
    installProgressListeners.forEach(listener => listener({ repository: fullName, kind, phase: 'configuring', percent: 90, message: kind === 'dsh' ? '正在切换本地启动命令' : '正在更新插件配置' }))
    await wait(350)
    if (kind === 'dsh') {
      demoDshInstallation = { installed: true, version: '0.1.0-rc.6', executable: `${demoSettings.dshInstallPath}\\node_modules\\.bin\\dsh.cmd`, source: 'launcher' }
      demoSettings = { ...demoSettings, launchExecutable: demoDshInstallation.executable!, launchArgs: ['web'] }
    } else if (repo && !demoPlugins.some(plugin => plugin.repositoryFullName === fullName)) {
      demoPlugins = renumber([...demoPlugins, {
        packageName: `@${repo.owner}/${repo.name.toLowerCase()}`,
        displayName: repo.name,
        version: 'github',
        description: repo.description,
        repository: repo.url,
        repositoryFullName: repo.fullName,
        enabled: true,
        builtin: false,
        locked: false,
        compatible: true,
        order: 0,
      }])
    }
    installProgressListeners.forEach(listener => listener({ repository: fullName, kind, phase: 'complete', percent: 100, message: kind === 'dsh' ? 'DSH 已安装' : '插件安装完成' }))
    const analysis = kind === 'plugin' ? demoAnalysis(fullName, repo?.defaultBranch ?? 'main') : null
    return {
      kind,
      profile: profile(),
      settings: demoSettings,
      dshInstallation: demoDshInstallation,
      installedProfileName: analysis?.targets[0].profileName,
      packageName: analysis?.targets[0].packageName,
    }
  },
  uninstallPlugin: async packageName => {
    demoPlugins = renumber(demoPlugins.filter(plugin => plugin.packageName !== packageName))
    return profile()
  },
  installSkill: async request => {
    const analysis = demoSkillAnalysis(request.repository, request.defaultBranch)
    const target = analysis.targets.find(item => item.id === request.targetId)
    if (!target) throw new Error('Skill 安装目标无效。')
    installProgressListeners.forEach(listener => listener({ repository: request.repository, kind: 'skill', phase: 'downloading', percent: 42, message: '正在下载 Skill' }))
    await wait(500)
    const installedSkill: InstalledSkill = {
      name: target.name,
      description: target.description,
      path: `${demoSettings.dshHome}\\skills\\${target.name}`,
      format: target.format,
      enabled: true,
      modelInvocable: target.modelInvocable,
      userInvocable: target.userInvocable,
    }
    demoInstalledSkills = [...demoInstalledSkills.filter(skill => skill.name !== target.name), installedSkill]
    installProgressListeners.forEach(listener => listener({ repository: request.repository, kind: 'skill', phase: 'complete', percent: 100, message: `${target.name} 已安装` }))
    return { installedSkill, installedSkills: demoInstalledSkills }
  },
  readInstalledSkills: async () => demoInstalledSkills,
  toggleSkill: async (name, enabled) => {
    demoInstalledSkills = demoInstalledSkills.map(skill => skill.name === name ? { ...skill, enabled } : skill)
    return demoInstalledSkills
  },
  getRuntimeState: async () => demoRuntime,
  startRuntime: async () => {
    demoRuntime = { running: true, pid: 18420, startedAt: new Date().toISOString(), url: 'http://127.0.0.1:3080' }
    stateListeners.forEach(listener => listener(demoRuntime))
    outputListeners.forEach(listener => listener({ channel: 'runtime', level: 'success', text: 'DeepSeek Harness Web UI: http://127.0.0.1:3080', timestamp: new Date().toISOString() }))
    return demoRuntime
  },
  stopRuntime: async () => {
    demoRuntime = { ...demoRuntime, running: false, pid: null }
    stateListeners.forEach(listener => listener(demoRuntime))
    return demoRuntime
  },
  openExternal: async () => undefined,
  openPath: async () => undefined,
  setWindowMode: async () => undefined,
  closeWindow: async () => undefined,
  onRuntimeOutput: listener => {
    outputListeners.add(listener)
    return () => outputListeners.delete(listener)
  },
  onRuntimeState: listener => {
    stateListeners.add(listener)
    return () => stateListeners.delete(listener)
  },
  onInstallProgress: listener => {
    installProgressListeners.add(listener)
    return () => installProgressListeners.delete(listener)
  },
  aiInstall: async input => {
    demoAiCancelled = false
    setDemoAiStatus({ phase: 'preparing', repository: input.repository, startedAt: new Date().toISOString(), sessionId: null, message: '正在准备 ACP 运行时…' })
    emitAiEvent({ kind: 'log', text: `开始研究 ${input.repository}（分支 ${input.defaultBranch}）` })
    await wait(500)
    emitAiEvent({ kind: 'snapshot', snapshotId: `demo-${Date.now()}` })
    emitAiEvent({ kind: 'log', text: '已为当前 profile 生成配置快照。' })
    setDemoAiStatus({ phase: 'running', sessionId: 'demo-session', message: 'AI 正在研究仓库并尝试安装…' })
    await wait(700)
    emitAiEvent({ kind: 'log', text: '读取仓库结构，确认组件形态…' })
    emitAiEvent({ kind: 'auto-approved', toolName: 'read_file', reason: '只读操作，自动放行' })
    await wait(400)
    emitAiEvent({ kind: 'log', text: '发现组件位于 `packages/web-app`，需要写入 profile 配置。' })
    emitAiEvent({ kind: 'approval', request: { id: 'demo-1', toolName: 'bash', toolKind: 'bash', args: 'dsh plugin add @demo/dsh-web-app --profile web', reason: '写文件或运行安装命令，需要确认' } })
    // 挂起等待 aiApprove 裁决；取消由 aiCancel 兜底（resolve(false) 并置 cancelled）。
    const allowed = await new Promise<boolean>(resolve => {
      demoAiResolve = resolve
    })
    if (demoAiCancelled) return { ok: false, message: '用户已取消' }
    emitAiEvent({ kind: 'log', text: allowed ? '已批准安装命令。' : '已拒绝安装命令。' })
    if (allowed) {
      setDemoAiStatus({ phase: 'done', message: 'AI 已完成研究并安装组件。' })
      emitAiEvent({ kind: 'log', text: '组件已写入 profile，安装完成。' })
      emitAiEvent({ kind: 'done', message: 'AI 已完成研究并安装组件。请检查改动；不满意可还原快照。' })
      return { ok: true, message: 'AI 已完成研究并安装组件。' }
    }
    setDemoAiStatus({ phase: 'done', message: 'AI 已完成研究，但安装命令被拒绝。' })
    emitAiEvent({ kind: 'done', message: '安装命令被拒绝，任务结束。快照仍保留，可还原。' })
    return { ok: false, message: '安装命令被拒绝。' }
  },
  aiApprove: async (requestId, allow) => {
    if (requestId !== 'demo-1' || !demoAiResolve) return false
    demoAiResolve(Boolean(allow))
    demoAiResolve = null
    return true
  },
  aiCancel: async () => {
    demoAiCancelled = true
    if (demoAiResolve) {
      demoAiResolve(false)
      demoAiResolve = null
    }
    setDemoAiStatus({ phase: 'cancelled', message: '用户已取消' })
    emitAiEvent({ kind: 'cancelled', message: '用户已取消任务。快照仍保留，可还原。' })
  },
  aiRollback: async () => {
    emitAiEvent({ kind: 'log', text: '正在还原快照…' })
    await wait(400)
    emitAiEvent({ kind: 'log', text: '配置已还原到任务前状态。' })
    return { restored: 2, profileName: demoSettings.profileName }
  },
  aiStatus: async () => demoAiStatus,
  aiHasSnapshot: async () => demoAiStatus.phase !== 'idle',
  onAiInstallEvent: listener => {
    aiEventListeners.add(listener)
    return () => aiEventListeners.delete(listener)
  },
}
