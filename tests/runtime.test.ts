import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { extractLocalUrl, findAvailableWebPort, isDshWebLaunch, runtimeEnvironment, withDshWebPort } from '../electron/runtime'
import type { AppSettings } from '../src/types'

describe('extractLocalUrl', () => {
  it('picks up a loopback address with a port', () => {
    expect(extractLocalUrl('Server listening on http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173')
  })

  it('accepts localhost and a path', () => {
    expect(extractLocalUrl('open http://localhost:3000/workspace now')).toBe('http://localhost:3000/workspace')
  })

  it('accepts https and a bare host', () => {
    expect(extractLocalUrl('ready at https://localhost')).toBe('https://localhost')
  })

  it('ignores addresses that are not local', () => {
    expect(extractLocalUrl('docs at https://example.com/guide')).toBeNull()
  })

  it('returns null when there is no address at all', () => {
    expect(extractLocalUrl('compiling…')).toBeNull()
  })
})

describe('runtimeEnvironment', () => {
  const settings = {
    dshInstallPath: '/home/tester/.dsh-runtime',
    dshHome: '/home/tester/.dsh',
    profileName: 'web',
    workspace: '/home/tester/Documents',
    launchExecutable: 'npx',
    launchArgs: ['web'],
    webPort: 3080,
    openAfterLaunch: true,
  } satisfies AppSettings

  it('injects DSH_HOME and disables colored output', () => {
    const environment = runtimeEnvironment(settings, { PATH: '/usr/bin' })
    expect(environment.DSH_HOME).toBe('/home/tester/.dsh')
    expect(environment.FORCE_COLOR).toBe('0')
    expect(environment.PATH).toBe('/usr/bin')
  })

  it('overrides an inherited DSH_HOME', () => {
    expect(runtimeEnvironment(settings, { DSH_HOME: '/stale' }).DSH_HOME).toBe('/home/tester/.dsh')
  })
})

describe('DSH Web 端口', () => {
  it('识别直接调用和 npx 调用的 DSH Web 命令', () => {
    expect(isDshWebLaunch('/opt/dsh/dsh', ['web'])).toBe(true)
    expect(isDshWebLaunch('npx', ['--yes', '@deepseek-ai/dsh', 'web'])).toBe(true)
    expect(isDshWebLaunch('node', ['./server.js'])).toBe(false)
  })

  it('替换旧端口参数并保留其他参数', () => {
    expect(withDshWebPort('dsh.cmd', ['web', '--port', '4000', '--host', '127.0.0.1'], 3082)).toEqual([
      'web', '--host', '127.0.0.1', '--port', '3082',
    ])
    expect(withDshWebPort('npx', ['--yes', '@deepseek-ai/dsh', 'web', '--port=4000'], 3083)).toEqual([
      '--yes', '@deepseek-ai/dsh', 'web', '--port', '3083',
    ])
  })

  it('首选端口占用时选择后续端口', async () => {
    const checked: number[] = []
    const selected = await findAvailableWebPort(3080, 10, async port => {
      checked.push(port)
      return port === 3082
    })
    expect(selected).toBe(3082)
    expect(checked).toEqual([3080, 3081, 3082])
  })

  it('候选端口全部占用时返回 null', async () => {
    await expect(findAvailableWebPort(3080, 3, async () => false)).resolves.toBeNull()
  })

  it('在本机真实端口被监听时跳过该端口', async () => {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port: 0 }, () => resolve())
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('未能取得测试端口。')
      const selected = await findAvailableWebPort(address.port, 10)
      expect(selected).not.toBeNull()
      expect(selected).not.toBe(address.port)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
