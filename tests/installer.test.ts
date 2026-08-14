import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPluginCommandArgs } from '../electron/installer'
import type { AppSettings } from '../src/types'

const onDemand: AppSettings = {
  dshHome: '/home/tester/.dsh',
  profileName: 'web',
  workspace: '/home/tester/Documents',
  launchExecutable: 'npx',
  launchArgs: ['--yes', '@deepseek-ai/dsh', 'web'],
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
