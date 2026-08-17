import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandOptions } from '../electron/command'
import {
  buildPluginCommandArgs,
  createInstaller,
  resolveInstallProfile,
  validateLocalPluginDirectory,
} from '../electron/installer'
import { analyzeRepository } from '../electron/plugin-catalog'
import { readProfile } from '../electron/profile'
import { recordPluginInstall, removePluginReceipt } from '../electron/plugin-receipts'
import type { NodeRuntime } from '../electron/node-runtime'
import type { AppSettings, PluginInstallTarget, ProfileState } from '../src/types'

vi.mock('../electron/profile', async importOriginal => {
  const actual = await importOriginal<typeof import('../electron/profile')>()
  return { ...actual, readProfile: vi.fn() }
})

vi.mock('../electron/plugin-catalog', async importOriginal => {
  const actual = await importOriginal<typeof import('../electron/plugin-catalog')>()
  return { ...actual, analyzeRepository: vi.fn() }
})

vi.mock('../electron/plugin-receipts', async importOriginal => {
  const actual = await importOriginal<typeof import('../electron/plugin-receipts')>()
  return { ...actual, recordPluginInstall: vi.fn(), removePluginReceipt: vi.fn() }
})

const onDemand: AppSettings = {
  dshInstallPath: '/home/tester/.dsh-runtime',
  dshHome: '/home/tester/.dsh',
  profileName: 'web',
  workspace: '/home/tester/Documents',
  launchExecutable: 'npx',
  launchArgs: ['--yes', '@deepseek-ai/dsh', 'web'],
  webPort: 3080,
  openAfterLaunch: true,
}

describe('buildPluginCommandArgs', () => {
  it('reuses the npx prefix up to and including the package specifier', () => {
    expect(buildPluginCommandArgs(onDemand, 'npx', ['add', 'github:someone/plugin'])).toEqual([
      '--yes', '@deepseek-ai/dsh',
      'plugin', '--profile', 'web',
      'add', 'github:someone/plugin',
    ])
  })

  it('drops the launch subcommand that follows the package specifier', () => {
    // launchArgs 末尾的 web 是启动 DSH 用的，插件命令不能带上它。
    const headless: AppSettings = { ...onDemand, profileName: 'headless' }
    expect(buildPluginCommandArgs(headless, 'npx', ['remove', 'some-plugin'])).toEqual([
      '--yes', '@deepseek-ai/dsh',
      'plugin', '--profile', 'headless',
      'remove', 'some-plugin',
    ])
  })

  it('calls a bound dsh executable directly without a package prefix', () => {
    const bound: AppSettings = {
      ...onDemand,
      launchExecutable: '/opt/dsh/node_modules/.bin/dsh',
      launchArgs: ['web'],
    }
    expect(buildPluginCommandArgs(bound, '/opt/dsh/node_modules/.bin/dsh', ['add', 'github:a/b'])).toEqual([
      'plugin', '--profile', 'web',
      'add', 'github:a/b',
    ])
  })

  it('recognizes the dsh.cmd wrapper used on Windows', () => {
    const executable = path.join('C:', 'runtime', 'node_modules', '.bin', 'dsh.cmd')
    const bound: AppSettings = { ...onDemand, launchExecutable: executable, launchArgs: ['web'] }
    expect(buildPluginCommandArgs(bound, executable, ['add', 'github:a/b'])[0]).toBe('plugin')
  })

  it('falls back to fetching the package when the executable is unrelated', () => {
    const custom: AppSettings = { ...onDemand, launchExecutable: 'node', launchArgs: ['./server.js'] }
    expect(buildPluginCommandArgs(custom, 'node', ['add', 'github:a/b'])).toEqual([
      '--yes', '@deepseek-ai/dsh',
      'plugin', '--profile', 'web',
      'add', 'github:a/b',
    ])
  })

  it('carries a custom profile name through', () => {
    const headless: AppSettings = { ...onDemand, profileName: 'headless' }
    expect(buildPluginCommandArgs(headless, 'npx', ['add', 'github:a/b'])).toContain('headless')
  })
})

// ---------------------------------------------------------------------------
// 测试替身：createInstaller 的 DI 沿用 main.ts 的装配方式，额外注入
// runCommand 命令执行器替身与 readProfile / analyzeRepository 桩。
// ---------------------------------------------------------------------------

let temporaryDirectory = ''
let settings: AppSettings
let calls: Array<{ executable: string; args: string[]; options: CommandOptions }>

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'dsh-installer-test-'))
  calls = []
  settings = {
    dshInstallPath: path.join(temporaryDirectory, 'runtime'),
    dshHome: path.join(temporaryDirectory, 'dsh-home'),
    profileName: 'web',
    workspace: path.join(temporaryDirectory, 'workspace'),
    launchExecutable: 'npx',
    launchArgs: ['--yes', '@deepseek-ai/dsh', 'web'],
    webPort: 3080,
    openAfterLaunch: true,
  }
  vi.resetAllMocks()
})

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = ''
})

function createTestInstaller() {
  const nodeRuntime: NodeRuntime = {
    root: path.join(temporaryDirectory, 'node'),
    node: path.join(temporaryDirectory, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
    npm: path.join(temporaryDirectory, 'node', process.platform === 'win32' ? 'npm.cmd' : 'npm'),
    npx: path.join(temporaryDirectory, 'node', process.platform === 'win32' ? 'npx.cmd' : 'npx'),
    managed: true,
  }
  const pnpmExecutable = path.join(
    temporaryDirectory,
    'pnpm-runtime',
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  )
  const installer = createInstaller({
    readSettings: async () => settings,
    saveSettings: async next => next,
    prepareNodeRuntime: async () => nodeRuntime,
    preparePnpmRuntime: async () => ({ root: path.join(temporaryDirectory, 'pnpm-runtime'), executable: pnpmExecutable }),
    pluginSourceRoot: path.join(temporaryDirectory, 'plugin-source'),
    pluginReceiptsPath: path.join(temporaryDirectory, 'receipts.json'),
    skillSourceRoot: path.join(temporaryDirectory, 'skill-source'),
    emitOutput: () => {},
    emitProgress: () => {},
    isRuntimeRunning: () => false,
    runCommand: async (executable, args, options) => {
      calls.push({ executable, args, options })
      return { exitCode: 0, output: '' }
    },
  })
  return { installer, calls, settings, pnpmExecutable }
}

function profileState(profileName: string, packageName: string): ProfileState {
  return {
    initialized: true,
    profileDir: path.join('dsh-home', 'profiles', profileName),
    manifestPath: path.join('dsh-home', 'profiles', profileName, 'package.json'),
    plugins: [{
      packageName,
      displayName: packageName,
      version: '1.0.0',
      description: '',
      enabled: true,
      builtin: false,
      locked: false,
      compatible: true,
      order: 1,
    }],
    activeBundles: [packageName],
    dependencyCount: 1,
    disabledCount: 0,
  }
}

function localDirectoryTarget(localDirectory: string): PluginInstallTarget {
  return {
    id: 'demo-plugin:.',
    packageName: 'demo-plugin',
    version: null,
    source: 'local-directory',
    profileName: 'web',
    platform: 'unknown',
    subdirectory: null,
    commit: '',
    requiresBuild: false,
    buildScripts: [],
    nodeRange: null,
    localDirectory,
  }
}

describe('resolveInstallProfile', () => {
  it('prefers the explicit profile override over the target profile', () => {
    const target = localDirectoryTarget('/tmp/plugin')
    expect(resolveInstallProfile(target, 'pack-a')).toBe('pack-a')
  })

  it('falls back to the target profile when no override is given', () => {
    const target = { ...localDirectoryTarget('/tmp/plugin'), profileName: 'tui' }
    expect(resolveInstallProfile(target)).toBe('tui')
  })

  it('falls back to the default profile when neither is present', () => {
    const target = { ...localDirectoryTarget('/tmp/plugin'), profileName: undefined } as unknown as PluginInstallTarget
    expect(resolveInstallProfile(target)).toBe('web')
  })
})

describe('validateLocalPluginDirectory', () => {
  it('accepts an existing absolute plugin directory', async () => {
    const localDirectory = await mkdtemp(path.join(temporaryDirectory, 'local-plugin-'))
    await writeFile(path.join(localDirectory, 'package.json'), JSON.stringify({ name: 'demo-plugin' }))
    expect(validateLocalPluginDirectory(localDirectory)).toBe(localDirectory)
  })

  it('rejects a relative path and a missing directory', () => {
    expect(() => validateLocalPluginDirectory('relative/dir')).toThrow(/绝对路径/)
    expect(() => validateLocalPluginDirectory(path.join(temporaryDirectory, 'missing-dir'))).toThrow(/不存在/)
  })
})

describe('installPluginTarget with local-directory source', () => {
  it('installs from the local directory into the resolved profile without downloading', async () => {
    const localDirectory = await mkdtemp(path.join(temporaryDirectory, 'local-plugin-'))
    await writeFile(path.join(localDirectory, 'package.json'), JSON.stringify({ name: 'demo-plugin' }))

    vi.mocked(analyzeRepository).mockResolvedValue({
      repository: 'demo/plugin',
      defaultBranch: 'main',
      installability: 'ready',
      summary: 'ok',
      targets: [localDirectoryTarget(localDirectory)],
    })
    vi.mocked(readProfile).mockResolvedValue(profileState('tui', 'demo-plugin'))

    const { installer, calls, pnpmExecutable } = createTestInstaller()
    const result = await installer.installPluginTarget(
      { repository: 'demo/plugin', defaultBranch: 'main', targetId: 'demo-plugin:.' },
      'tui',
    )

    const addCall = calls.find(call => call.args.includes('add'))
    expect(addCall).toBeDefined()
    expect(addCall!.args).toEqual([
      '--yes', '@deepseek-ai/dsh',
      'plugin', '--profile', 'tui',
      'add', `file:${localDirectory}`,
    ])
    // 平台感知：Windows 上 node 运行时会落到 npx.cmd，POSIX 上为 npx。
    expect(path.basename(addCall!.executable).toLowerCase()).toBe(process.platform === 'win32' ? 'npx.cmd' : 'npx')
    const pathKey = Object.keys(addCall!.options.env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
    expect(addCall!.options.env[pathKey]?.split(path.delimiter)).toContain(path.dirname(pnpmExecutable))
    expect(recordPluginInstall).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ packageName: 'demo-plugin', profileName: 'tui', source: 'local-directory' }),
    )
    expect(result.installedProfileName).toBe('tui')
  })

  it('rejects a local-directory target without a valid local directory', async () => {
    vi.mocked(analyzeRepository).mockResolvedValue({
      repository: 'demo/plugin',
      defaultBranch: 'main',
      installability: 'ready',
      summary: 'ok',
      targets: [{ ...localDirectoryTarget(path.join(temporaryDirectory, 'nope')), localDirectory: path.join(temporaryDirectory, 'nope') }],
    })

    const { installer, calls } = createTestInstaller()
    await expect(installer.installPluginTarget(
      { repository: 'demo/plugin', defaultBranch: 'main', targetId: 'demo-plugin:.' },
      'tui',
    )).rejects.toThrow(/不存在/)
    expect(calls.filter(call => call.args.includes('add'))).toHaveLength(0)
  })
})

describe('installPluginTarget with github source and pinned commit', () => {
  function githubTarget(commit: string): PluginInstallTarget {
    return {
      id: 'demo-plugin:.',
      packageName: 'demo-plugin',
      version: '1.0.0',
      source: 'github',
      profileName: 'tui',
      platform: 'unknown',
      subdirectory: null,
      commit,
      requiresBuild: false,
      buildScripts: [],
      nodeRange: null,
    }
  }

  it('优先使用请求里的固定 commit 构造 specifier，而不是重新分析得到的 HEAD commit', async () => {
    vi.mocked(analyzeRepository).mockResolvedValue({
      repository: 'demo/plugin',
      defaultBranch: 'main',
      installability: 'ready',
      summary: 'ok',
      targets: [githubTarget('c0ffee11')],
    })
    vi.mocked(readProfile).mockResolvedValue(profileState('tui', 'demo-plugin'))

    const { installer, calls } = createTestInstaller()
    await installer.installPluginTarget(
      { repository: 'demo/plugin', defaultBranch: 'main', targetId: 'demo-plugin:.', commit: 'abc1234' },
      'tui',
    )

    const addCall = calls.find(call => call.args.includes('add'))
    expect(addCall).toBeDefined()
    expect(addCall!.args).toContain('github:demo/plugin#abc1234')
  })

  it('未提供 pin 时回退到分析得到的 commit', async () => {
    vi.mocked(analyzeRepository).mockResolvedValue({
      repository: 'demo/plugin',
      defaultBranch: 'main',
      installability: 'ready',
      summary: 'ok',
      targets: [githubTarget('c0ffee11')],
    })
    vi.mocked(readProfile).mockResolvedValue(profileState('tui', 'demo-plugin'))

    const { installer, calls } = createTestInstaller()
    await installer.installPluginTarget(
      { repository: 'demo/plugin', defaultBranch: 'main', targetId: 'demo-plugin:.' },
      'tui',
    )

    const addCall = calls.find(call => call.args.includes('add'))
    expect(addCall!.args).toContain('github:demo/plugin#c0ffee11')
  })
})

describe('remove with profileName', () => {
  it('passes --profile to the CLI and removes the matching receipt', async () => {
    vi.mocked(readProfile).mockResolvedValue(profileState('tui', 'some-plugin'))
    const { installer, calls } = createTestInstaller()

    await installer.remove('some-plugin', 'tui')

    const removeCall = calls.find(call => call.args.includes('remove'))
    expect(removeCall).toBeDefined()
    expect(removeCall!.args).toEqual([
      '--yes', '@deepseek-ai/dsh',
      'plugin', '--profile', 'tui',
      'remove', 'some-plugin',
    ])
    expect(removePluginReceipt).toHaveBeenCalledWith(expect.any(String), 'tui', 'some-plugin')
  })

  it('defaults to the settings profile when no profileName is given', async () => {
    vi.mocked(readProfile).mockResolvedValue(profileState('web', 'some-plugin'))
    const { installer, calls } = createTestInstaller()

    await installer.remove('some-plugin')

    const removeCall = calls.find(call => call.args.includes('remove'))
    expect(removeCall).toBeDefined()
    expect(removeCall!.args).toEqual([
      '--yes', '@deepseek-ai/dsh',
      'plugin', '--profile', 'web',
      'remove', 'some-plugin',
    ])
    expect(removePluginReceipt).toHaveBeenCalledWith(expect.any(String), 'web', 'some-plugin')
  })
})
