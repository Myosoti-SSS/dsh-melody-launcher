import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'

interface SpawnCommandOptions {
  cwd: string
  env: NodeJS.ProcessEnv
}

function quoteWindowsBatchToken(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error('命令参数不能包含换行或空字符。')
  return `"${value.replace(/"/g, '""')}"`
}

export function buildWindowsBatchCommand(executable: string, args: string[]): string {
  return `"${[executable, ...args].map(quoteWindowsBatchToken).join(' ')}"`
}

export function withExecutableDirectoryOnPath(
  executable: string,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (process.platform !== 'win32' || !path.isAbsolute(executable)) return environment
  const executableDirectory = path.dirname(executable)
  const pathKey = Object.keys(environment).find(key => key.toLowerCase() === 'path') ?? 'PATH'
  const currentPath = environment[pathKey] ?? ''
  const alreadyIncluded = currentPath
    .split(path.delimiter)
    .some(entry => entry.toLowerCase() === executableDirectory.toLowerCase())
  if (alreadyIncluded) return environment
  return {
    ...environment,
    [pathKey]: currentPath ? `${executableDirectory}${path.delimiter}${currentPath}` : executableDirectory,
  }
}

export function spawnCommand(
  executable: string,
  args: string[],
  options: SpawnCommandOptions,
): ChildProcessWithoutNullStreams {
  const environment = withExecutableDirectoryOnPath(executable, options.env)
  const isWindowsBatch = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)
  if (isWindowsBatch) {
    const commandInterpreter = environment.ComSpec || process.env.ComSpec || 'cmd.exe'
    return spawn(commandInterpreter, [
      '/d',
      '/s',
      '/v:off',
      '/c',
      buildWindowsBatchCommand(executable, args),
    ], {
      ...options,
      env: environment,
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  return spawn(executable, args, {
    ...options,
    env: environment,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}
