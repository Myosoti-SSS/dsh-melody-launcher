import { describe, expect, it } from 'vitest'
import { compareDshMarketVersions, dshMarketInstallTarget, findDshMarketInstalledAlias, parseDshMarketSourceUrl } from '../electron/dsh-market'

describe('dsh-market source rules', () => {
  it('uses npm before GitHub and preserves monorepo subpaths', () => {
    expect(dshMarketInstallTarget({ url: 'https://github.com/a/b', npm: 'dsh-demo' })).toBe('dsh-demo')
    expect(dshMarketInstallTarget({ url: 'https://github.com/a/b/tree/main/packages/demo', npm: null })).toBe('github:a/b#path:/packages/demo')
    expect(parseDshMarketSourceUrl('https://github.com/a/b/tree/main/../secret')).toBeNull()
  })

  it('matches the same curated entry but keeps different GitHub sources apart', () => {
    const entry = { name: 'dsh-demo', owner: 'a', url: 'https://github.com/a/b', npm: null }
    expect(findDshMarketInstalledAlias(entry, { 'dsh-demo': 'github:a/b' })).toBe('dsh-demo')
    expect(findDshMarketInstalledAlias(entry, { 'dsh-demo': 'github:x/y' })).toBeNull()
    expect(findDshMarketInstalledAlias({ ...entry, npm: 'dsh-demo' }, { 'dsh-demo': 'dsh-demo' })).toBe('dsh-demo')
  })

  it('only treats a newer npm version as an update', () => {
    expect(compareDshMarketVersions('1.0.0', '1.1.0')).toBeLessThan(0)
    expect(compareDshMarketVersions('1.1.0', '1.0.0')).toBeGreaterThan(0)
    expect(compareDshMarketVersions('git', '1.0.0')).toBeNull()
  })
})
