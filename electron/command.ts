import { spawnCommand } from './process'

/**
 * 「启动子进程 → 转发输出 → 收集输出 → 等待退出码」这套流程原本在
 * 插件命令和 DSH 本体安装两处各写了一遍。这里抽成单一实现。
 */

export type OutputLevel = 'info' | 'error'

/** 只描述本模块真正用到的部分，便于测试传入替身。 */
export interface CommandProcess {
  stdout: NodeJS.ReadableStream
  stderr: NodeJS.ReadableStream
  once(event: 'error', listener: (error: Error) => void): unknown
  once(event: 'exit', listener: (code: number | null) => void): unknown
}

export interface CollectOptions {
  /** 每段输出到达时回调，用于转发到日志面板和进度解析。 */
  onOutput?: (text: string, level: OutputLevel) => void
  /** 保留的输出上限（字符数），只保留末尾部分。 */
  captureLimit?: number
}

export interface CommandOptions extends CollectOptions {
  cwd: string
  env: NodeJS.ProcessEnv
}

export interface CommandResult {
  exitCode: number
  /** 末尾若干字符的合并输出（stdout 与 stderr 按到达顺序）。 */
  output: string
}

export const DEFAULT_CAPTURE_LIMIT = 48_000

/** 监听一个已启动的子进程直到退出。子进程报错时 reject。 */
export function collectCommandOutput(child: CommandProcess, options: CollectOptions = {}): Promise<CommandResult> {
  const limit = options.captureLimit ?? DEFAULT_CAPTURE_LIMIT
  let output = ''

  const handle = (level: OutputLevel) => (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    output = `${output}${text}`.slice(-limit)
    options.onOutput?.(text, level)
  }
  child.stdout.on('data', handle('info'))
  child.stderr.on('data', handle('error'))

  return new Promise<CommandResult>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolve({ exitCode: code ?? 1, output }))
  })
}

/** 启动一条命令并等待它结束。 */
export async function runCommand(
  executable: string,
  args: string[],
  options: CommandOptions,
): Promise<CommandResult> {
  const child = spawnCommand(executable, args, { cwd: options.cwd, env: options.env })
  return collectCommandOutput(child, options)
}
