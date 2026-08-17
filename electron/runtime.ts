import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import { DSH_PACKAGE_NAME } from '../src/constants'
import type { AppSettings, RuntimeFailure, RuntimeOutput, RuntimeState } from '../src/types'
import type { ApplicationLaunchPlan, ApplicationLaunchSpec } from './application-addons'
import { requiresNodeRuntime, resolveNodeExecutable, type NodeRuntime } from './node-runtime'
import { pathExists } from './profile'
import { spawnCommand, withExecutableDirectoryOnPath } from './process'

/** DSH 进程的生命周期：启动、停止、输出转发与状态广播。 */

/** 从进程输出里识别本地服务地址。 */
export function extractLocalUrl(text: string): string | null {
  const match = text.match(/https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/[^\s]*)?/i)
  return match?.[0] ?? null
}

/** 构造 DSH 子进程的环境变量。 */
export function runtimeEnvironment(settings: AppSettings, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...base, DSH_HOME: settings.dshHome, FORCE_COLOR: '0' }
}

export const PORT_FALLBACK_ATTEMPTS = 10

/** 只有明确的 DSH Web 启动命令才注入 --port，避免破坏用户的其他自定义命令。 */
export function isDshWebLaunch(executable: string, args: string[]): boolean {
  const executableName = path.basename(executable).toLowerCase()
  const invokesDsh = executableName === 'dsh' || executableName === 'dsh.cmd' || args.includes(DSH_PACKAGE_NAME)
  const launchesWeb = args.includes('web') || args.some((value, index) => value === '--profile' && args[index + 1] === 'web')
  return invokesDsh && launchesWeb
}

/** 用设置中的首选端口替换可能存在的旧 --port 参数。 */
export function withDshWebPort(executable: string, args: string[], port: number): string[] {
  if (!isDshWebLaunch(executable, args)) return [...args]
  const next: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--port') {
      index += 1
      continue
    }
    if (value.startsWith('--port=')) continue
    next.push(value)
  }
  return [...next, '--port', String(port)]
}

export async function isLoopbackPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(error => resolve(error === undefined))
    })
  })
}

/** 从首选端口开始向后寻找；到达 65535 后从 1 继续。 */
export async function findAvailableWebPort(
  preferredPort: number,
  attempts = PORT_FALLBACK_ATTEMPTS,
  isAvailable: (port: number) => Promise<boolean> = isLoopbackPortAvailable,
): Promise<number | null> {
  const total = Math.max(1, Math.min(65535, Math.floor(attempts)))
  for (let offset = 0; offset < total; offset += 1) {
    const port = ((preferredPort - 1 + offset) % 65535) + 1
    if (await isAvailable(port)) return port
  }
  return null
}

const STDERR_CAPTURE_LIMIT = 24_000

export interface RuntimeControllerOptions {
  readSettings: () => Promise<AppSettings>
  /** 确保有可用的 Node.js，返回其可执行文件位置。 */
  prepareNodeRuntime: () => Promise<NodeRuntime>
  /** 配置的工作目录不存在时的回落目录。 */
  fallbackWorkspace: () => string
  emitOutput: (level: RuntimeOutput['level'], text: string) => void
  emitState: (state: RuntimeState) => void
  openExternal: (url: string) => void
  resolveApplicationLaunchPlan?: () => Promise<ApplicationLaunchPlan>
  spawnProcess?: typeof spawnCommand
  stopProcess?: (processToStop: ChildProcessWithoutNullStreams) => Promise<void>
}

export interface RuntimeController {
  state(): RuntimeState
  failure(): RuntimeFailure | null
  isRunning(): boolean
  start(): Promise<RuntimeState>
  stop(): Promise<RuntimeState>
}

export function createRuntimeController(options: RuntimeControllerOptions): RuntimeController {
  const startProcess = options.spawnProcess ?? spawnCommand
  let child: ChildProcessWithoutNullStreams | null = null
  const companions = new Map<string, ChildProcessWithoutNullStreams>()
  let companionTimer: NodeJS.Timeout | null = null
  let startedAt: string | null = null
  let url: string | null = null
  let port: number | null = null
  let lastFailure: RuntimeFailure | null = null
  let launchMode: RuntimeState['launchMode'] = 'web'
  let applicationAddonId: string | null = null
  let applicationAddonName: string | null = null

  const state = (): RuntimeState => ({
    running: child !== null,
    pid: child?.pid ?? null,
    startedAt,
    url,
    port,
    launchMode,
    applicationAddonId,
    applicationAddonName,
    lastFailure,
  })

  const broadcast = () => options.emitState(state())

  const killProcessTree = async (processToStop: ChildProcessWithoutNullStreams): Promise<void> => {
    if (options.stopProcess) {
      await options.stopProcess(processToStop)
      return
    }
    if (process.platform === 'win32' && processToStop.pid) {
      const killer = spawn('taskkill.exe', ['/pid', String(processToStop.pid), '/t', '/f'], { windowsHide: true })
      await new Promise<void>(resolve => {
        killer.once('error', () => resolve())
        killer.once('exit', () => resolve())
      })
      return
    }
    processToStop.kill('SIGTERM')
  }

  const stopCompanions = async (): Promise<void> => {
    if (companionTimer) {
      clearTimeout(companionTimer)
      companionTimer = null
    }
    const running = [...companions.values()]
    companions.clear()
    await Promise.allSettled(running.map(killProcessTree))
  }

  const startCompanions = (
    specs: ApplicationLaunchSpec[],
    settings: AppSettings,
  ): void => {
    if (companionTimer) {
      clearTimeout(companionTimer)
      companionTimer = null
    }
    for (const spec of specs) {
      if (companions.has(spec.id)) continue
      try {
        const environment = withExecutableDirectoryOnPath(spec.executable, runtimeEnvironment(settings, process.env))
        const companion = startProcess(spec.executable, spec.args, { cwd: spec.cwd, env: environment })
        companions.set(spec.id, companion)
        options.emitOutput('info', `伴随应用已启动：${spec.name}`)
        companion.stdout.on('data', chunk => options.emitOutput('info', `[${spec.name}] ${chunk.toString('utf8')}`))
        companion.stderr.on('data', chunk => options.emitOutput('error', `[${spec.name}] ${chunk.toString('utf8')}`))
        companion.once('error', error => options.emitOutput('error', `${spec.name} 启动失败：${error.message}`))
        companion.once('exit', code => {
          companions.delete(spec.id)
          options.emitOutput(code === 0 ? 'success' : 'error', `${spec.name} 已退出（代码 ${code ?? '未知'}）`)
        })
      } catch (error) {
        options.emitOutput('error', `${spec.name} 启动失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  async function start(): Promise<RuntimeState> {
    if (child) return state()

    const settings = await options.readSettings()
    const defaultCwd = (await pathExists(settings.workspace)) ? settings.workspace : options.fallbackWorkspace()
    const applicationPlan = options.resolveApplicationLaunchPlan
      ? await options.resolveApplicationLaunchPlan()
      : { replacement: null, companions: [] }
    const replacement = applicationPlan.replacement
    const cwd = replacement?.cwd ?? defaultCwd

    let executable = replacement?.executable ?? settings.launchExecutable
    let environment = runtimeEnvironment(settings, process.env)
    let launchArgs = replacement?.args ?? settings.launchArgs
    if (requiresNodeRuntime(executable, launchArgs)) {
      const nodeRuntime = await options.prepareNodeRuntime()
      executable = resolveNodeExecutable(executable, nodeRuntime)
      environment = withExecutableDirectoryOnPath(nodeRuntime.node, environment)
    }

    launchMode = replacement ? 'application-replacement' : 'web'
    applicationAddonId = replacement?.id ?? null
    applicationAddonName = replacement?.name ?? null
    if (replacement) {
      port = null
      options.emitOutput('info', `启动模式：${replacement.name} 替代普通 DSH Web`)
    } else if (isDshWebLaunch(executable, launchArgs)) {
      const selectedPort = await findAvailableWebPort(settings.webPort)
      if (selectedPort === null) {
        const message = `从端口 ${settings.webPort} 开始连续检测 ${PORT_FALLBACK_ATTEMPTS} 个端口，均不可用。`
        options.emitOutput('error', message)
        throw new Error(message)
      }
      port = selectedPort
      launchArgs = withDshWebPort(executable, launchArgs, selectedPort)
      if (selectedPort === settings.webPort) {
        options.emitOutput('info', `Web 端口：${selectedPort}`)
      } else {
        options.emitOutput('info', `首选端口 ${settings.webPort} 已被占用，自动改用 ${selectedPort}。`)
      }
    } else {
      port = null
    }

    const commandLine = `${executable} ${launchArgs.join(' ')}`
    options.emitOutput('info', `启动：${commandLine}`)
    options.emitOutput('info', `工作目录：${cwd}`)

    lastFailure = null
    const started = startProcess(executable, launchArgs, { cwd, env: environment })
    child = started
    startedAt = new Date().toISOString()
    url = null
    broadcast()

    let stderrOutput = ''
    let diagnosticOutput = ''
    const handleData = (level: RuntimeOutput['level']) => (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      diagnosticOutput = `${diagnosticOutput}${text}`.slice(-STDERR_CAPTURE_LIMIT)
      if (level === 'error') stderrOutput = `${stderrOutput}${text}`.slice(-STDERR_CAPTURE_LIMIT)
      options.emitOutput(level, text)
      const foundUrl = extractLocalUrl(text)
      if (foundUrl && foundUrl !== url) {
        url = foundUrl
        broadcast()
        if (!replacement && settings.openAfterLaunch) options.openExternal(foundUrl)
        startCompanions(applicationPlan.companions, settings)
      }
    }
    started.stdout.on('data', handleData('info'))
    started.stderr.on('data', handleData('error'))

    started.once('error', error => {
      lastFailure = {
        profileName: settings.profileName,
        diagnostics: `启动命令：${commandLine}\n工作目录：${cwd}\n\n${diagnosticOutput}\n${error.stack ?? error.message}`.slice(-STDERR_CAPTURE_LIMIT),
        failedAt: new Date().toISOString(),
      }
      options.emitOutput('error', `启动失败：${error.message}`)
      void stopCompanions()
      broadcast()
    })
    started.once('exit', code => {
      // stop() 会先把 child 置空，据此区分主动停止与意外退出。
      const expected = child === null
      child = null
      port = null
      void stopCompanions()
      if (!expected && code !== 0 && stderrOutput.includes('EADDRINUSE')) {
        options.emitOutput('error', '选中的本地端口在启动过程中被其他进程占用，请重新启动，启动器会继续选择其他可用端口。')
      }
      if (!expected && code !== 0) {
        lastFailure = {
          profileName: settings.profileName,
          diagnostics: [
            `启动命令：${commandLine}`,
            `工作目录：${cwd}`,
            `退出代码：${code ?? '未知'}`,
            '',
            diagnosticOutput.trim() || '进程没有输出诊断信息。',
          ].join('\n').slice(-STDERR_CAPTURE_LIMIT),
          failedAt: new Date().toISOString(),
        }
      }
      const processName = replacement?.name ?? 'DSH'
      options.emitOutput(code === 0 || expected ? 'success' : 'error', `${processName} 已退出（代码 ${code ?? '未知'}）`)
      broadcast()
    })

    if (applicationPlan.companions.length > 0) {
      companionTimer = setTimeout(() => startCompanions(applicationPlan.companions, settings), 5_000)
      companionTimer.unref()
    }

    return state()
  }

  async function stop(): Promise<RuntimeState> {
    const running = child
    if (!running) {
      await stopCompanions()
      return state()
    }
    child = null
    port = null
    applicationAddonId = null
    applicationAddonName = null

    await Promise.allSettled([killProcessTree(running), stopCompanions()])

    options.emitOutput('info', '已发送停止请求。')
    broadcast()
    return state()
  }

  return {
    state,
    failure: () => lastFailure,
    isRunning: () => child !== null,
    start,
    stop,
  }
}
