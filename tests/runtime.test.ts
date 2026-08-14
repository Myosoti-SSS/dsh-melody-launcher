import { describe, expect, it } from 'vitest'
import { extractLocalUrl, runtimeEnvironment } from '../electron/runtime'
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
    dshHome: '/home/tester/.dsh',
    profileName: 'web',
    workspace: '/home/tester/Documents',
    launchExecutable: 'npx',
    launchArgs: ['web'],
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
