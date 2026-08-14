import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DSH_REPOSITORY,
  getManagedDshStatus,
  isDshRepository,
  managedDshExecutable,
  packageManagerProgress,
} from '../electron/dsh-install'

let runtimeRoot = ''

beforeEach(async () => {
  runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-launcher-runtime-'))
})

afterEach(async () => {
  await rm(runtimeRoot, { recursive: true, force: true })
})

describe('managed DSH installation', () => {
  it('recognizes only the official repository as the DSH application', () => {
    expect(isDshRepository(DSH_REPOSITORY)).toBe(true)
    expect(isDshRepository('DeepSeek-AI/DeepSeek-Harness')).toBe(true)
    expect(isDshRepository('community/deepseek-harness')).toBe(false)
  })

  it('reports a missing or incomplete managed installation', async () => {
    await expect(getManagedDshStatus(runtimeRoot)).resolves.toEqual({
      installed: false,
      version: null,
      executable: null,
    })
  })

  it('returns the installed version and executable', async () => {
    const packageDirectory = path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh')
    const executable = managedDshExecutable(runtimeRoot)
    await mkdir(packageDirectory, { recursive: true })
    await mkdir(path.dirname(executable), { recursive: true })
    await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({ version: '0.1.0-rc.6' }), 'utf8')
    await writeFile(executable, 'dsh', 'utf8')

    await expect(getManagedDshStatus(runtimeRoot)).resolves.toEqual({
      installed: true,
      version: '0.1.0-rc.6',
      executable,
    })
  })

  it('turns package-manager and git output into bounded progress', () => {
    expect(packageManagerProgress('Progress: resolved 20, reused 5, downloaded 10, added 8', 30)).toEqual({
      percent: 66,
      message: '正在下载：10 个新包，5 个已复用',
    })
    expect(packageManagerProgress('Receiving objects: 50% (100/200)', 20)).toEqual({
      percent: 53,
      message: '正在下载仓库 50%',
    })
    expect(packageManagerProgress('added 104 packages in 8s', 40)).toEqual({
      percent: 82,
      message: '下载完成，正在安装依赖',
    })
  })
})
