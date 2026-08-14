import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AppSettings,
  DiscoveryResult,
  InstallProgress,
  RepositoryInstallResult,
  RepositoryResult,
  RuntimeOutput,
  RuntimeState,
  WindowMode,
} from '../src/types'
import {
  isSafePackageName,
  isSafeProfileName,
  isSafeRepositoryName,
  pathExists,
  readProfile,
  reorderPlugins,
  togglePlugin,
} from './profile'
import {
  clearDeepSeekApiKey,
  getDeepSeekCredentialStatus,
  setDeepSeekApiKey,
} from './credentials'
import { spawnCommand, withExecutableDirectoryOnPath } from './process'
import {
  getManagedDshStatus,
  isDshRepository,
  packageManagerProgress,
} from './dsh-install'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let runtimeProcess: ChildProcessWithoutNullStreams | null = null
let runtimeStartedAt: string | null = null
let runtimeUrl: string | null = null
let settingsCache: AppSettings | null = null
let quitAfterRuntimeStops = false
let activeInstallation: InstallProgress | null = null

const WINDOW_MODES: Record<WindowMode, { width: number; height: number; minWidth: number; minHeight: number }> = {
  launcher: { width: 900, height: 560, minWidth: 760, minHeight: 480 },
  manager: { width: 1380, height: 860, minWidth: 1024, minHeight: 680 },
}

function findNpx(): string {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const pathCandidates = (process.env.PATH ?? '').split(path.delimiter).map(entry => path.join(entry, executable))
  if (process.platform === 'win32') {
    pathCandidates.unshift(path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'npx.cmd'))
  }
  return pathCandidates.find(candidate => Boolean(candidate && path.isAbsolute(candidate)) && existsSync(candidate)) ?? executable
}

function findNpm(): string {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const pathCandidates = (process.env.PATH ?? '').split(path.delimiter).map(entry => path.join(entry, executable))
  if (process.platform === 'win32') {
    pathCandidates.unshift(path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'npm.cmd'))
  }
  return pathCandidates.find(candidate => Boolean(candidate && path.isAbsolute(candidate)) && existsSync(candidate)) ?? executable
}

function managedDshRoot(): string {
  return path.join(app.getPath('userData'), 'dsh-runtime')
}

function setWindowMode(mode: WindowMode): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const size = WINDOW_MODES[mode]
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  mainWindow.setMinimumSize(size.minWidth, size.minHeight)
  mainWindow.setSize(size.width, size.height, true)
  mainWindow.center()
}

function withNodeOnPath(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return withExecutableDirectoryOnPath(findNpm(), environment)
}

function defaultSettings(): AppSettings {
  return {
    dshHome: process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
    profileName: 'web',
    workspace: app.getPath('documents'),
    launchExecutable: findNpx(),
    launchArgs: ['--yes', '@deepseek-ai/dsh', 'web'],
    openAfterLaunch: true,
  }
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

async function getSettings(): Promise<AppSettings> {
  if (settingsCache) return settingsCache
  const defaults = defaultSettings()
  try {
    const stored = JSON.parse(await readFile(settingsPath(), 'utf8')) as Partial<AppSettings>
    settingsCache = {
      ...defaults,
      ...stored,
      launchArgs: Array.isArray(stored.launchArgs) ? stored.launchArgs.filter(value => typeof value === 'string') : defaults.launchArgs,
    }
  } catch {
    settingsCache = defaults
  }
  return settingsCache
}

function validateSettings(input: AppSettings): AppSettings {
  if (!input || typeof input !== 'object') throw new Error('设置格式无效。')
  if (!isSafeProfileName(input.profileName)) throw new Error('配置名称只能包含字母、数字、点、横线或下划线。')
  if (!path.isAbsolute(input.dshHome) || !path.isAbsolute(input.workspace)) throw new Error('目录必须使用完整路径。')
  if (!input.launchExecutable.trim()) throw new Error('启动命令不能为空。')
  if (!Array.isArray(input.launchArgs) || input.launchArgs.some(value => typeof value !== 'string')) throw new Error('启动参数格式无效。')
  return {
    dshHome: input.dshHome,
    profileName: input.profileName,
    workspace: input.workspace,
    launchExecutable: input.launchExecutable.trim(),
    launchArgs: input.launchArgs,
    openAfterLaunch: Boolean(input.openAfterLaunch),
  }
}

async function saveSettings(input: AppSettings): Promise<AppSettings> {
  const next = validateSettings(input)
  await mkdir(path.dirname(settingsPath()), { recursive: true })
  await writeFile(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  settingsCache = next
  return next
}

function runtimeState(): RuntimeState {
  return {
    running: runtimeProcess !== null,
    pid: runtimeProcess?.pid ?? null,
    startedAt: runtimeStartedAt,
    url: runtimeUrl,
  }
}

function emitState(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send('runtime:state-changed', runtimeState())
}

function emitOutput(channel: RuntimeOutput['channel'], level: RuntimeOutput['level'], text: string): void {
  const normalized = text.replace(/\r\n/g, '\n').trimEnd()
  if (!normalized) return
  const output: RuntimeOutput = { channel, level, text: normalized, timestamp: new Date().toISOString() }
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send('runtime:output', output)
}

function emitInstallProgress(progress: InstallProgress): void {
  activeInstallation = progress
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send('plugins:install-progress', progress)
}

function currentInstallPercent(fallback: number): number {
  return activeInstallation?.percent ?? fallback
}

function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/[^\s]*)?/i)
  return match?.[0] ?? null
}

async function startRuntime(): Promise<RuntimeState> {
  if (runtimeProcess) return runtimeState()
  const settings = await getSettings()
  const cwd = (await pathExists(settings.workspace)) ? settings.workspace : app.getPath('documents')
  emitOutput('runtime', 'info', `启动：${settings.launchExecutable} ${settings.launchArgs.join(' ')}`)
  emitOutput('runtime', 'info', `工作目录：${cwd}`)
  const child = spawnCommand(settings.launchExecutable, settings.launchArgs, {
    cwd,
    env: withNodeOnPath({ ...process.env, DSH_HOME: settings.dshHome, FORCE_COLOR: '0' }),
  })
  runtimeProcess = child
  runtimeStartedAt = new Date().toISOString()
  runtimeUrl = null
  emitState()
  let stderrOutput = ''

  const handleData = (level: RuntimeOutput['level']) => (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    if (level === 'error') stderrOutput = `${stderrOutput}${text}`.slice(-24_000)
    emitOutput('runtime', level, text)
    const foundUrl = extractUrl(text)
    if (foundUrl && foundUrl !== runtimeUrl) {
      runtimeUrl = foundUrl
      emitState()
      if (settings.openAfterLaunch) void shell.openExternal(foundUrl)
    }
  }
  child.stdout.on('data', handleData('info'))
  child.stderr.on('data', handleData('error'))
  child.once('error', error => {
    emitOutput('runtime', 'error', `启动失败：${error.message}`)
  })
  child.once('exit', code => {
    const expected = runtimeProcess === null
    runtimeProcess = null
    if (!expected && code !== 0 && stderrOutput.includes('EADDRINUSE')) {
      emitOutput('runtime', 'error', '本地端口已被其他进程占用。请关闭旧的 DSH 服务，或在启动参数中指定其他端口。')
    }
    emitOutput('runtime', code === 0 || expected ? 'success' : 'error', `DSH 已退出（代码 ${code ?? '未知'}）`)
    emitState()
  })
  return runtimeState()
}

async function stopRuntime(): Promise<RuntimeState> {
  const child = runtimeProcess
  if (!child) return runtimeState()
  runtimeProcess = null
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
    await new Promise<void>(resolve => {
      killer.once('error', () => resolve())
      killer.once('exit', () => resolve())
    })
  } else {
    child.kill('SIGTERM')
  }
  emitOutput('runtime', 'info', '已发送停止请求。')
  emitState()
  return runtimeState()
}

async function runPluginCommand(args: string[], installingRepository?: string): Promise<void> {
  const settings = await getSettings()
  const executable = settings.launchExecutable
  const packageIndex = settings.launchArgs.indexOf('@deepseek-ai/dsh')
  const prefix = packageIndex >= 0
    ? settings.launchArgs.slice(0, packageIndex + 1)
    : path.basename(executable).toLowerCase().startsWith('dsh')
      ? []
      : ['--yes', '@deepseek-ai/dsh']
  const commandArgs = [...prefix, 'plugin', '--profile', settings.profileName, ...args]
  emitOutput('plugin', 'info', `插件操作：${args.join(' ')}`)
  if (installingRepository) {
    emitInstallProgress({ repository: installingRepository, kind: 'plugin', phase: 'resolving', percent: 18, message: '正在解析插件仓库' })
  }
  const child = spawnCommand(executable, commandArgs, {
    cwd: settings.workspace,
    env: withNodeOnPath({ ...process.env, DSH_HOME: settings.dshHome, FORCE_COLOR: '0' }),
  })
  if (installingRepository) {
    emitInstallProgress({ repository: installingRepository, kind: 'plugin', phase: 'downloading', percent: 28, message: '正在下载插件' })
  }
  const handleOutput = (level: RuntimeOutput['level']) => (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    emitOutput('plugin', level, text)
    if (!installingRepository) return
    const parsed = packageManagerProgress(text, currentInstallPercent(28))
    if (parsed) {
      emitInstallProgress({ repository: installingRepository, kind: 'plugin', phase: 'downloading', ...parsed })
    }
  }
  child.stdout.on('data', handleOutput('info'))
  child.stderr.on('data', handleOutput('error'))
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolve(code ?? 1))
  })
  if (exitCode !== 0) throw new Error(`插件操作失败（代码 ${exitCode}），请查看运行日志。`)
  emitOutput('plugin', 'success', '插件操作完成。')
}

async function installManagedDsh(repository: string): Promise<RepositoryInstallResult> {
  if (runtimeProcess) throw new Error('请先停止 DSH，再安装或更新本地 DSH。')
  const runtimeRoot = managedDshRoot()
  await mkdir(runtimeRoot, { recursive: true })
  const manifestPath = path.join(runtimeRoot, 'package.json')
  if (!existsSync(manifestPath)) {
    await writeFile(manifestPath, `${JSON.stringify({ name: 'dsh-launcher-runtime', private: true }, null, 2)}\n`, 'utf8')
  }

  emitInstallProgress({ repository, kind: 'dsh', phase: 'resolving', percent: 15, message: '正在解析 DSH 安装包' })
  const child = spawnCommand(findNpm(), [
    'install',
    '--prefix', runtimeRoot,
    '--save-exact',
    '--no-audit',
    '--no-fund',
    '--progress=true',
    '@deepseek-ai/dsh@latest',
  ], {
    cwd: runtimeRoot,
    env: { ...process.env, FORCE_COLOR: '0', NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
  })
  emitInstallProgress({ repository, kind: 'dsh', phase: 'downloading', percent: 28, message: '正在下载 DSH' })

  const handleOutput = (level: RuntimeOutput['level']) => (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    emitOutput('plugin', level, text)
    const parsed = packageManagerProgress(text, currentInstallPercent(28))
    if (parsed) emitInstallProgress({ repository, kind: 'dsh', phase: 'downloading', ...parsed })
  }
  child.stdout.on('data', handleOutput('info'))
  child.stderr.on('data', handleOutput('error'))
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolve(code ?? 1))
  })
  if (exitCode !== 0) throw new Error(`本地 DSH 安装失败（代码 ${exitCode}），请查看运行日志。`)

  emitInstallProgress({ repository, kind: 'dsh', phase: 'configuring', percent: 90, message: '正在切换本地启动命令' })
  const dshInstallation = await getManagedDshStatus(runtimeRoot)
  if (!dshInstallation.installed || !dshInstallation.executable) {
    throw new Error('安装完成，但没有找到本地 DSH 可执行文件。')
  }
  const currentSettings = await getSettings()
  const settings = await saveSettings({
    ...currentSettings,
    launchExecutable: dshInstallation.executable,
    launchArgs: ['web'],
  })
  const profile = await readProfile(settings.dshHome, settings.profileName)
  emitInstallProgress({
    repository,
    kind: 'dsh',
    phase: 'complete',
    percent: 100,
    message: `DSH ${dshInstallation.version ?? ''} 已安装`,
  })
  return { kind: 'dsh', profile, settings, dshInstallation }
}

async function installRepository(fullName: string): Promise<RepositoryInstallResult> {
  if (activeInstallation) throw new Error(`正在安装 ${activeInstallation.repository}，请等待当前任务完成。`)
  const kind = isDshRepository(fullName) ? 'dsh' : 'plugin'
  emitInstallProgress({ repository: fullName, kind, phase: 'preparing', percent: 5, message: kind === 'dsh' ? '正在准备本地 DSH' : '正在准备安装插件' })
  try {
    if (kind === 'dsh') return await installManagedDsh(fullName)
    await runPluginCommand(['add', `github:${fullName}`], fullName)
    emitInstallProgress({ repository: fullName, kind, phase: 'configuring', percent: 90, message: '正在更新插件配置' })
    const settings = await getSettings()
    const profile = await readProfile(settings.dshHome, settings.profileName)
    const dshInstallation = await getManagedDshStatus(managedDshRoot())
    emitInstallProgress({ repository: fullName, kind, phase: 'complete', percent: 100, message: '插件安装完成' })
    return { kind, profile, settings, dshInstallation }
  } catch (error) {
    emitInstallProgress({
      repository: fullName,
      kind,
      phase: 'error',
      percent: currentInstallPercent(0),
      message: error instanceof Error ? error.message : '安装失败',
    })
    throw error
  } finally {
    activeInstallation = null
  }
}

async function discoverPlugins(query: string, sort: 'stars' | 'updated'): Promise<DiscoveryResult> {
  const normalizedQuery = query.trim().replace(/[^\p{L}\p{N}._ -]/gu, ' ').slice(0, 80)
  const searchQuery = `topic:dsh-plugin${normalizedQuery ? ` ${normalizedQuery} in:name,description` : ''}`
  const url = new URL('https://api.github.com/search/repositories')
  url.searchParams.set('q', searchQuery)
  url.searchParams.set('sort', sort)
  url.searchParams.set('order', 'desc')
  url.searchParams.set('per_page', '30')
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DSH-Launcher',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) {
    if (response.status === 403) throw new Error('GitHub 请求额度暂时用尽，请稍后重试。')
    throw new Error(`GitHub 返回 ${response.status}，暂时无法获取插件。`)
  }
  const data = await response.json() as {
    total_count: number
    items: Array<{
      id: number
      full_name: string
      name: string
      owner: { login: string }
      description: string | null
      html_url: string
      stargazers_count: number
      language: string | null
      updated_at: string
      topics?: string[]
      default_branch: string
    }>
  }
  const repositories: RepositoryResult[] = data.items.map(item => ({
    id: item.id,
    fullName: item.full_name,
    name: item.name,
    owner: item.owner.login,
    description: item.description ?? '此仓库没有提供说明。',
    url: item.html_url,
    stars: item.stargazers_count,
    language: item.language,
    updatedAt: item.updated_at,
    topics: item.topics ?? [],
    defaultBranch: item.default_branch,
    kind: isDshRepository(item.full_name) ? 'dsh' : 'plugin',
  }))
  const remaining = Number(response.headers.get('x-ratelimit-remaining'))
  return {
    repositories,
    totalCount: data.total_count,
    rateRemaining: Number.isFinite(remaining) ? remaining : undefined,
    dshInstallation: await getManagedDshStatus(managedDshRoot()),
  }
}

function createWindow(): void {
  const initialSize = WINDOW_MODES.launcher
  mainWindow = new BrowserWindow({
    width: initialSize.width,
    height: initialSize.height,
    minWidth: initialSize.minWidth,
    minHeight: initialSize.minHeight,
    backgroundColor: '#151914',
    frame: false,
    hasShadow: true,
    title: 'DSH Launcher',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.once('closed', () => { mainWindow = null })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function registerHandlers(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_event, settings: AppSettings) => saveSettings(settings))
  ipcMain.handle('credentials:deepseek-status', async () => {
    const settings = await getSettings()
    return getDeepSeekCredentialStatus(settings.dshHome)
  })
  ipcMain.handle('credentials:deepseek-set', async (_event, apiKey: string) => {
    if (typeof apiKey !== 'string') throw new Error('API Key 格式无效。')
    const settings = await getSettings()
    return setDeepSeekApiKey(settings.dshHome, apiKey)
  })
  ipcMain.handle('credentials:deepseek-clear', async () => {
    const settings = await getSettings()
    return clearDeepSeekApiKey(settings.dshHome)
  })
  ipcMain.handle('dialog:directory', async (_event, kind: 'dshHome' | 'workspace') => {
    const settings = await getSettings()
    const result = await dialog.showOpenDialog(mainWindow!, {
      defaultPath: kind === 'dshHome' ? settings.dshHome : settings.workspace,
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('profile:read', async () => {
    const settings = await getSettings()
    return readProfile(settings.dshHome, settings.profileName)
  })
  ipcMain.handle('profile:toggle', async (_event, payload: { packageName: string; enabled: boolean }) => {
    if (!isSafePackageName(payload.packageName)) throw new Error('插件名称无效。')
    const settings = await getSettings()
    return togglePlugin(settings.dshHome, settings.profileName, payload.packageName, Boolean(payload.enabled))
  })
  ipcMain.handle('profile:reorder', async (_event, packageNames: string[]) => {
    if (!Array.isArray(packageNames) || packageNames.some(name => !isSafePackageName(name))) throw new Error('插件顺序无效。')
    const settings = await getSettings()
    return reorderPlugins(settings.dshHome, settings.profileName, packageNames)
  })
  ipcMain.handle('plugins:discover', (_event, payload: { query: string; sort: 'stars' | 'updated' }) => {
    return discoverPlugins(payload.query ?? '', payload.sort === 'updated' ? 'updated' : 'stars')
  })
  ipcMain.handle('plugins:install', async (_event, fullName: string) => {
    if (!isSafeRepositoryName(fullName)) throw new Error('GitHub 仓库名称无效。')
    return installRepository(fullName)
  })
  ipcMain.handle('plugins:uninstall', async (_event, packageName: string) => {
    if (!isSafePackageName(packageName)) throw new Error('插件名称无效。')
    const settings = await getSettings()
    await runPluginCommand(['remove', packageName])
    return readProfile(settings.dshHome, settings.profileName)
  })
  ipcMain.handle('runtime:state', () => runtimeState())
  ipcMain.handle('runtime:start', () => startRuntime())
  ipcMain.handle('runtime:stop', () => stopRuntime())
  ipcMain.handle('window:set-mode', (_event, mode: WindowMode) => {
    if (mode !== 'launcher' && mode !== 'manager') throw new Error('窗口模式无效。')
    setWindowMode(mode)
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('shell:open-external', (_event, url: string) => {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只允许打开网页链接。')
    return shell.openExternal(parsed.toString())
  })
  ipcMain.handle('shell:open-path', async (_event, target: string) => {
    if (!path.isAbsolute(target)) throw new Error('路径无效。')
    await shell.openPath(target)
  })
}

app.whenReady().then(() => {
  registerHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', event => {
  if (quitAfterRuntimeStops || !runtimeProcess) return
  event.preventDefault()
  void stopRuntime().finally(() => {
    quitAfterRuntimeStops = true
    app.quit()
  })
})
