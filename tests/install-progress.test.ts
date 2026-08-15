import { describe, expect, it } from 'vitest'
import { isInstallProgressActive } from '../src/lib/install-progress'
import type { InstallProgress } from '../src/types'

function progress(phase: InstallProgress['phase']): InstallProgress {
  return {
    repository: 'demo/plugin',
    kind: 'plugin',
    phase,
    percent: 50,
    message: phase,
  }
}

describe('install progress lifecycle', () => {
  it('restores every in-flight phase after a view remount', () => {
    for (const phase of ['preparing', 'resolving', 'downloading', 'building', 'configuring', 'verifying'] as const) {
      expect(isInstallProgressActive(progress(phase))).toBe(true)
    }
  })

  it('does not restore completed, failed, or absent tasks', () => {
    expect(isInstallProgressActive(progress('complete'))).toBe(false)
    expect(isInstallProgressActive(progress('error'))).toBe(false)
    expect(isInstallProgressActive(null)).toBe(false)
  })
})
