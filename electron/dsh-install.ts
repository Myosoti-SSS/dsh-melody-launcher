import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { DshInstallationStatus } from '../src/types'

export const DSH_REPOSITORY = 'deepseek-ai/deepseek-harness'

export function isDshRepository(fullName: string): boolean {
  return fullName.toLowerCase() === DSH_REPOSITORY
}

export function managedDshExecutable(runtimeRoot: string): string {
  return path.join(runtimeRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
}

export function packageManagerProgress(text: string, currentPercent: number): { percent: number; message: string } | null {
  const pnpmMatches = [...text.matchAll(/Progress:\s*resolved\s+(\d+),\s*reused\s+(\d+),\s*downloaded\s+(\d+),\s*added\s+(\d+)/gi)]
  const pnpm = pnpmMatches.at(-1)
  if (pnpm) {
    const resolved = Number(pnpm[1])
    const reused = Number(pnpm[2])
    const downloaded = Number(pnpm[3])
    const processed = Math.min(resolved, reused + downloaded)
    const percent = resolved > 0 ? 25 + Math.round((processed / resolved) * 55) : 25
    return {
      percent: Math.max(currentPercent, Math.min(80, percent)),
      message: `正在下载：${downloaded} 个新包，${reused} 个已复用`,
    }
  }

  const gitMatches = [...text.matchAll(/Receiving objects:\s*(\d+)%/gi)]
  const git = gitMatches.at(-1)
  if (git) {
    const received = Math.min(100, Number(git[1]))
    return {
      percent: Math.max(currentPercent, 25 + Math.round(received * 0.55)),
      message: `正在下载仓库 ${received}%`,
    }
  }

  if (/added\s+\d+\s+packages?/i.test(text) || /Packages:\s*\+\d+/i.test(text)) {
    return { percent: Math.max(currentPercent, 82), message: '下载完成，正在安装依赖' }
  }
  if (/download|fetch|resolve|reify|progress:/i.test(text)) {
    return { percent: Math.max(currentPercent, 35), message: '正在下载所需文件' }
  }
  return null
}

export async function getManagedDshStatus(runtimeRoot: string): Promise<DshInstallationStatus> {
  const executable = managedDshExecutable(runtimeRoot)
  try {
    const packageJson = JSON.parse(await readFile(path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')) as {
      version?: unknown
    }
    await readFile(executable)
    if (typeof packageJson.version !== 'string' || !packageJson.version.trim()) throw new Error('missing version')
    return { installed: true, version: packageJson.version, executable }
  } catch {
    return { installed: false, version: null, executable: null }
  }
}
