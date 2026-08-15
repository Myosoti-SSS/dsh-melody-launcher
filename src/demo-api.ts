import type {
  AppSettings,
  CredentialStatus,
  DshInstallationStatus,
  DiscoveryResult,
  InstallProgress,
  InstalledSkill,
  LauncherApi,
  ManagedPlugin,
  ProfileState,
  RepositoryAnalysis,
  RepositoryResult,
  RuntimeOutput,
  RuntimeState,
  SkillDiscoveryResult,
  SkillRepositoryAnalysis,
  SkillRepositoryResult,
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
    packageName: '@ccch1mneyyy/dsh-tui',
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

const demoRepositories: RepositoryResult[] = [
  { id: 0, fullName: 'deepseek-ai/deepseek-harness', name: 'deepseek-harness', owner: 'deepseek-ai', description: 'DeepSeek Harness 官方本体。', url: 'https://github.com/deepseek-ai/deepseek-harness', stars: 71883, language: 'TypeScript', updatedAt: '2026-08-14T05:20:00Z', topics: ['dsh-plugin', 'dsh', 'cordis'], defaultBranch: 'master', kind: 'dsh' },
  { id: 1, fullName: 'zhu1090093659/dsh-web-ui', name: 'dsh-web-ui', owner: 'zhu1090093659', description: 'Plugin and skin collection for DeepSeek Harness Web UI.', url: 'https://github.com/zhu1090093659/dsh-web-ui', stars: 863, language: 'TypeScript', updatedAt: '2026-08-14T03:20:00Z', topics: ['dsh-plugin', 'web-ui', 'deepseek-harness'], defaultBranch: 'main', kind: 'plugin' },
  { id: 2, fullName: 'liustack/modlens', name: 'modlens', owner: 'liustack', description: 'The first vision plugin for DeepSeek Harness.', url: 'https://github.com/liustack/modlens', stars: 829, language: 'TypeScript', updatedAt: '2026-08-14T02:10:00Z', topics: ['dsh-plugin', 'vision', 'ocr'], defaultBranch: 'main', kind: 'plugin' },
  { id: 3, fullName: 'ccch1mneyyy/dsh-TUI', name: 'dsh-TUI', owner: 'ccch1mneyyy', description: 'Claude Code 风格全屏交互终端插件。', url: 'https://github.com/ccch1mneyyy/dsh-TUI', stars: 443, language: 'TypeScript', updatedAt: '2026-08-14T04:10:00Z', topics: ['dsh-plugin', 'tui', 'terminal'], defaultBranch: 'main', kind: 'plugin' },
  { id: 4, fullName: 'omdsh-dev/DSH-better-sidebar', name: 'DSH-better-sidebar', owner: 'omdsh-dev', description: '支持文件、终端、Git 和子代理的侧边栏工作台。', url: 'https://github.com/omdsh-dev/DSH-better-sidebar', stars: 337, language: 'TypeScript', updatedAt: '2026-08-13T21:30:00Z', topics: ['dsh-plugin', 'sidebar'], defaultBranch: 'main', kind: 'plugin' },
]

const demoSkillRepositories: SkillRepositoryResult[] = [
  { id: 101, fullName: 'TohsakaRIN521/dsh-academic-skill', name: 'dsh-academic-skill', owner: 'TohsakaRIN521', description: 'Academic writing and verification skills for DSH.', url: 'https://github.com/TohsakaRIN521/dsh-academic-skill', stars: 210, language: 'Python', updatedAt: '2026-08-15T03:20:00Z', topics: ['dsh-skill', 'academic'], defaultBranch: 'main' },
  { id: 102, fullName: 'v587d/dsh-multimodal-skill', name: 'dsh-multimodal-skill', owner: 'v587d', description: 'Multimodal image and audio workflows.', url: 'https://github.com/v587d/dsh-multimodal-skill', stars: 96, language: 'Python', updatedAt: '2026-08-14T23:10:00Z', topics: ['dsh-skill', 'multimodal'], defaultBranch: 'main' },
  { id: 103, fullName: '2BingLing/dsh-market', name: 'dsh-market', owner: '2BingLing', description: 'DSH ecosystem index.', url: 'https://github.com/2BingLing/dsh-market', stars: 350, language: 'TypeScript', updatedAt: '2026-08-15T02:10:00Z', topics: ['dsh-skill', 'market'], defaultBranch: 'master' },
]

let demoInstalledSkills: InstalledSkill[] = []

let demoRuntime: RuntimeState = { running: false, pid: null, startedAt: null, url: null }
let demoCredential: CredentialStatus = { configured: false }
let demoDshInstallation: DshInstallationStatus = { installed: false, version: null, executable: null, source: null }
const outputListeners = new Set<(output: RuntimeOutput) => void>()
const stateListeners = new Set<(state: RuntimeState) => void>()
const installProgressListeners = new Set<(progress: InstallProgress) => void>()

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
  const packageName = fullName === 'liustack/modlens'
    ? '@liustack/modlens'
    : fullName === 'ccch1mneyyy/dsh-TUI'
      ? 'dsh-cc-tui'
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
      profileName: packageName === 'dsh-cc-tui' ? 'cc-tui' : 'web',
      platform: packageName === 'dsh-cc-tui' ? 'terminal' : 'web',
      subdirectory: null,
      commit: 'a'.repeat(40),
      requiresBuild: false,
      buildScripts: [],
      nodeRange: '>=22.19',
    }],
  }
}

function demoSkillAnalysis(fullName: string, defaultBranch: string): SkillRepositoryAnalysis {
  if (fullName === '2BingLing/dsh-market') {
    return { repository: fullName, defaultBranch, installability: 'invalid', summary: '没有找到符合 DSH 规范的 SKILL.md 或单文件 Skill。', targets: [] }
  }
  const names = fullName.includes('academic') ? ['academic-paper-completion', 'skill-optimizer'] : ['multimodal-workflow']
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

export const demoApi: LauncherApi = {
  getSettings: async () => demoSettings,
  saveSettings: async settings => (demoSettings = settings),
  detectDshInstallation: async () => ({ ...demoDshInstallation }),
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
  discoverPlugins: async (query, sort): Promise<DiscoveryResult> => {
    const needle = query.trim().toLowerCase()
    const repositories = demoRepositories
      .filter(repo => !needle || `${repo.fullName} ${repo.description}`.toLowerCase().includes(needle))
      .sort((a, b) => sort === 'stars' ? b.stars - a.stars : b.updatedAt.localeCompare(a.updatedAt))
    return {
      repositories,
      totalCount: 916,
      rateRemaining: 9,
      dshInstallation: demoDshInstallation,
      installedRepositories: demoPlugins.map(plugin => plugin.repositoryFullName).filter((value): value is string => Boolean(value)),
    }
  },
  analyzePlugin: async (fullName, defaultBranch) => demoAnalysis(fullName, defaultBranch),
  installPlugin: async request => {
    const fullName = typeof request === 'string' ? request : request.repository
    const repo = demoRepositories.find(item => item.fullName === fullName)
    const kind = repo?.kind ?? 'plugin'
    installProgressListeners.forEach(listener => listener({ repository: fullName, kind, phase: 'resolving', percent: 18, message: kind === 'dsh' ? '正在解析 DSH 安装包' : '正在解析插件仓库' }))
    await wait(350)
    installProgressListeners.forEach(listener => listener({ repository: fullName, kind, phase: 'downloading', percent: 28, message: kind === 'dsh' ? '正在下载并安装 DSH' : '正在下载并安装插件', indeterminate: true }))
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
  discoverSkills: async (query, sort): Promise<SkillDiscoveryResult> => {
    const needle = query.trim().toLowerCase()
    const repositories = demoSkillRepositories
      .filter(repo => !needle || `${repo.fullName} ${repo.description}`.toLowerCase().includes(needle))
      .sort((left, right) => sort === 'stars' ? right.stars - left.stars : right.updatedAt.localeCompare(left.updatedAt))
    return { repositories, totalCount: demoSkillRepositories.length, rateRemaining: 32, installedSkills: demoInstalledSkills }
  },
  analyzeSkill: async (fullName, defaultBranch) => demoSkillAnalysis(fullName, defaultBranch),
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
      modelInvocable: target.modelInvocable,
      userInvocable: target.userInvocable,
    }
    demoInstalledSkills = [...demoInstalledSkills.filter(skill => skill.name !== target.name), installedSkill]
    installProgressListeners.forEach(listener => listener({ repository: request.repository, kind: 'skill', phase: 'complete', percent: 100, message: `${target.name} 已安装` }))
    return { installedSkill, installedSkills: demoInstalledSkills }
  },
  readInstalledSkills: async () => demoInstalledSkills,
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
}
