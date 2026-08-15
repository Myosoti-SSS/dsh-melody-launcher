import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPluginReceipts, recordPluginInstall, removePluginReceipt } from '../electron/plugin-receipts'

let temporaryDirectory = ''
let receiptPath = ''

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'dsh-launcher-receipts-'))
  receiptPath = path.join(temporaryDirectory, 'plugin-installs.json')
})
afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('plugin install receipts', () => {
  it('updates one package receipt without dropping other profiles', async () => {
    const base = {
      repository: 'demo/plugin',
      packageName: '@demo/plugin',
      source: 'npm' as const,
      subdirectory: null,
      version: '1.0.0',
      commit: 'a'.repeat(40),
      installedAt: '2026-08-14T00:00:00.000Z',
    }
    await recordPluginInstall(receiptPath, { ...base, profileName: 'web' })
    await recordPluginInstall(receiptPath, { ...base, profileName: 'tui' })
    await recordPluginInstall(receiptPath, { ...base, profileName: 'web', version: '1.1.0' })

    const receipts = await readPluginReceipts(receiptPath)
    expect(receipts).toHaveLength(2)
    expect(receipts.find(item => item.profileName === 'web')?.version).toBe('1.1.0')

    await removePluginReceipt(receiptPath, 'web', '@demo/plugin')
    await expect(readPluginReceipts(receiptPath)).resolves.toMatchObject([{ profileName: 'tui' }])
  })
})
