import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AppSettings, RuntimeOutput, RuntimeState } from '../src/types'
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
}

export interface RuntimeController {
  state(): RuntimeState
  isRunning(): boolean
  start(): Promise<RuntimeState>
  stop(): Promise<RuntimeState>
}

export function createRuntimeController(options: RuntimeControllerOptions): RuntimeController {
  let child: ChildProcessWithoutNullStreams | null = null
  let startedAt: string | null = null
  let url: string | null = null

  const state = (): RuntimeState => ({
    running: child !== null,
    pid: child?.pid ?? null,
    startedAt,
    url,
  })

  const broadcast = () => options.emitState(state())

  async function start(): Promise<RuntimeState> {
    if (child) return state()

    const settings = await options.readSettings()
    const cwd = (await pathExists(settings.workspace)) ? settings.workspace : options.fallbackWorkspace()

    let executable = settings.launchExecutable
    let environment = runtimeEnvironment(settings, process.env)
    if (requiresNodeRuntime(executable, settings.launchArgs)) {
      const nodeRuntime = await options.prepareNodeRuntime()
      executable = resolveNodeExecutable(executable, nodeRuntime)
      environment = withExecutableDirectoryOnPath(nodeRuntime.node, environment)
    }

    options.emitOutput('info', `启动：${executable} ${settings.launchArgs.join(' ')}`)
    options.emitOutput('info', `工作目录：${cwd}`)

    const started = spawnCommand(executable, settings.launchArgs, { cwd, env: environment })
    child = started
    startedAt = new Date().toISOString()
    url = null
    broadcast()

    let stderrOutput = ''
    const handleData = (level: RuntimeOutput['level']) => (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (level === 'error') stderrOutput = `${stderrOutput}${text}`.slice(-STDERR_CAPTURE_LIMIT)
      options.emitOutput(level, text)
      const foundUrl = extractLocalUrl(text)
      if (foundUrl && foundUrl !== url) {
        url = foundUrl
        broadcast()
        if (settings.openAfterLaunch) options.openExternal(foundUrl)
      }
    }
    started.stdout.on('data', handleData('info'))
    started.stderr.on('data', handleData('error'))

    started.once('error', error => {
      options.emitOutput('error', `启动失败：${error.message}`)
    })
    started.once('exit', code => {
      // stop() 会先把 child 置空，据此区分主动停止与意外退出。
      const expected = child === null
      child = null
      if (!expected && code !== 0 && stderrOutput.includes('EADDRINUSE')) {
        options.emitOutput('error', '本地端口已被其他进程占用。请关闭旧的 DSH 服务，或在启动参数中指定其他端口。')
      }
      options.emitOutput(code === 0 || expected ? 'success' : 'error', `DSH 已退出（代码 ${code ?? '未知'}）`)
      broadcast()
    })

    return state()
  }

  async function stop(): Promise<RuntimeState> {
    const running = child
    if (!running) return state()
    child = null

    if (process.platform === 'win32' && running.pid) {
      // DSH 会派生子进程，必须整棵进程树一起结束。
      const killer = spawn('taskkill.exe', ['/pid', String(running.pid), '/t', '/f'], { windowsHide: true })
      await new Promise<void>(resolve => {
        killer.once('error', () => resolve())
        killer.once('exit', () => resolve())
      })
    } else {
      running.kill('SIGTERM')
    }

    options.emitOutput('info', '已发送停止请求。')
    broadcast()
    return state()
  }

  return {
    state,
    isRunning: () => child !== null,
    start,
    stop,
  }
}
