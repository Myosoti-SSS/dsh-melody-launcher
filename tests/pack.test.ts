import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, PackManifest, PackPluginEntry, ProfileState } from '../src/types'
import { createPackManager, type PackInstallTarget } from '../electron/pack'
import { buildPackZip } from '../electron/pack-zip'
import { readPackRegistry, upsertPackRecord, type PackRecord } from '../electron/pack-registry'
import { recordPluginInstall, type PluginInstallReceipt } from '../electron/plugin-receipts'
import { defaultSettings } from '../electron/settings'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const temporaryRoots: string[] = []
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temporaryDirectory(prefix = 'dsh-pack-mgr-'): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

async function makeEnv(): Promise<{
  root: string
  dshHome: string
  registryPath: string
  snapshotRoot: string
  pluginReceiptsPath: string
}> {
  const root = await temporaryDirectory()
  const dshHome = path.join(root, 'dsh-home')
  await mkdir(path.join(dshHome, 'profiles'), { recursive: true })
  return {
    root,
    dshHome,
    registryPath: path.join(root, 'packs.json'),
    snapshotRoot: path.join(root, 'pack-snapshots'),
    pluginReceiptsPath: path.join(root, 'plugin-installs.json'),
  }
}

const defaultProfile: ProfileState = {
  initialized: true,
  profileDir: '',
  manifestPath: '',
  plugins: [],
  activeBundles: [],
  dependencyCount: 0,
  disabledCount: 0,
}

function makeInstallerStub() {
  const installPluginTarget = vi.fn(async (_target: PackInstallTarget): Promise<void> => {})
  const remove = vi.fn(async (_packageName: string, _profileName?: string): Promise<void> => {})
  const readProfile = vi.fn(async (): Promise<ProfileState> => defaultProfile)
  const togglePlugin = vi.fn(async (): Promise<ProfileState> => defaultProfile)
  return { installPluginTarget, remove, readProfile, togglePlugin }
}

type InstallerStub = ReturnType<typeof makeInstallerStub>

function makeSettings(dshHome: string, profileName = 'web') {
  let current: AppSettings = {
    ...defaultSettings({ homeDirectory: os.homedir(), documentsDirectory: os.homedir() }),
    dshHome,
    profileName,
  }
  const saveSettings = vi.fn(async (next: AppSettings) => { current = next; return current })
  const readSettings = vi.fn(async () => current)
  return { readSettings, saveSettings, get current(): AppSettings { return current } }
}

type SettingsStoreMock = ReturnType<typeof makeSettings>

interface MakeManagerOptions {
  isRuntimeRunning?: () => boolean
  isInstallerBusy?: () => boolean
}

function makeManager(
  env: Awaited<ReturnType<typeof makeEnv>>,
  installer: InstallerStub,
  store: SettingsStoreMock,
  options: MakeManagerOptions = {},
) {
  const emitEvent = vi.fn()
  const manager = createPackManager({
    readSettings: store.readSettings,
    saveSettings: store.saveSettings,
    registryPath: env.registryPath,
    snapshotRoot: env.snapshotRoot,
    pluginReceiptsPath: env.pluginReceiptsPath,
    installer,
    emitEvent,
    isRuntimeRunning: options.isRuntimeRunning ?? (() => false),
    isInstallerBusy: options.isInstallerBusy ?? (() => false),
    dshHome: env.dshHome,
  })
  return { manager, emitEvent }
}

function recordFor(id: string, plugins: PackRecord['plugins'] = []): PackRecord {
  return {
    id,
    name: id,
    description: '',
    version: '1.0.0',
    source: 'created',
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    state: 'complete',
    plugins,
  }
}

function receipt(packageName: string, profileName: string, source: PluginInstallReceipt['source'] = 'npm'): PluginInstallReceipt {
  return {
    repository: 'demo/owner',
    packageName,
    profileName,
    source,
    subdirectory: null,
    version: '1.2.3',
    commit: 'abc1234',
    installedAt: new Date().toISOString(),
  }
}

async function writeZip(env: Awaited<ReturnType<typeof makeEnv>>, fileName: string, manifest: PackManifest, bodies: Map<string, string>): Promise<string> {
  const zipPath = path.join(env.root, fileName)
  await writeFile(zipPath, Buffer.from(buildPackZip(manifest, bodies)))
  return zipPath
}

function managedPlugin(packageName: string) {
  return {
    packageName,
    displayName: packageName,
    version: '1.0.0',
    description: '',
    enabled: true,
    builtin: false,
    locked: false,
    compatible: true,
    order: 1,
  }
}

// ---------------------------------------------------------------------------
// createPack
// ---------------------------------------------------------------------------

describe('createPack', () => {
  it('按 receipt 重建 target，装进 pack profile（profileName = packId）', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome, 'web')
    const { manager } = makeManager(env, stub, store)
    await recordPluginInstall(env.pluginReceiptsPath, receipt('alpha', 'web', 'npm'))

    const result = await manager.createPack({ name: 'My Pack', description: 'd', packageNames: ['alpha'] })
    expect(result.installed).toEqual(['alpha'])
    expect(result.failures).toEqual([])
    expect(result.state).toBe('complete')

    expect(stub.installPluginTarget).toHaveBeenCalledTimes(1)
    const target = stub.installPluginTarget.mock.calls[0][0] as PackInstallTarget
    expect(target.profileName).toBe('pack-my-pack')
    expect(target.packageName).toBe('alpha')
    expect(target.source).toBe('npm')
    expect(target.repository).toBe('demo/owner')

    const records = await readPackRegistry(env.registryPath)
    expect(records).toHaveLength(1)
    expect(records[0].id).toBe('pack-my-pack')
    expect(records[0].plugins).toEqual([{ packageName: 'alpha', enabled: true }])
  })

  it('github 源 receipt 重建为 github target，subdirectory 保留', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome, 'web')
    const { manager } = makeManager(env, stub, store)
    await recordPluginInstall(env.pluginReceiptsPath, {
      ...receipt('alpha', 'web', 'github'),
      subdirectory: 'packages/alpha',
    })

    const result = await manager.createPack({ name: 'G', packageNames: ['alpha'] })
    expect(result.state).toBe('complete')
    const target = stub.installPluginTarget.mock.calls[0][0] as PackInstallTarget
    expect(target.source).toBe('github')
    expect(target.subdirectory).toBe('packages/alpha')
    expect(target.repository).toBe('demo/owner')
  })

  it('无来源记录的包名进 failures，state = failed', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome, 'web')
    const { manager } = makeManager(env, stub, store)

    const result = await manager.createPack({ name: 'Empty', packageNames: ['ghost'] })
    expect(result.installed).toEqual([])
    expect(result.failures).toEqual([{ packageName: 'ghost', reason: '无来源记录，无法重新安装' }])
    expect(result.state).toBe('failed')
    expect(stub.installPluginTarget).not.toHaveBeenCalled()
  })

  it('local 源 receipt 无法重建 → failure', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome, 'web')
    const { manager } = makeManager(env, stub, store)
    await recordPluginInstall(env.pluginReceiptsPath, receipt('local-pkg', 'web', 'local-directory'))

    const result = await manager.createPack({ name: 'L', packageNames: ['local-pkg'] })
    expect(result.state).toBe('failed')
    expect(result.failures[0].reason).toMatch(/缺少来源路径/)
    expect(stub.installPluginTarget).not.toHaveBeenCalled()
  })

  it('guard 拒绝：DSH 运行时正在运行', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome)
    const { manager } = makeManager(env, stub, store, { isRuntimeRunning: () => true })
    await expect(manager.createPack({ name: 'A', packageNames: ['alpha'] })).rejects.toThrow('DSH 运行时正在运行')
  })

  it('guard 拒绝：安装器忙', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome)
    const { manager } = makeManager(env, stub, store, { isInstallerBusy: () => true })
    await expect(manager.createPack({ name: 'A', packageNames: ['alpha'] })).rejects.toThrow('安装器忙')
  })

  it('guard 拒绝：已有整合包操作进行中', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome, 'web')
    const { manager } = makeManager(env, stub, store)
    await recordPluginInstall(env.pluginReceiptsPath, receipt('alpha', 'web'))

    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    stub.installPluginTarget.mockImplementationOnce(() => gate)

    const first = manager.createPack({ name: 'Busy Pack', packageNames: ['alpha'] })
    await vi.waitFor(() => expect(stub.installPluginTarget).toHaveBeenCalled())
    await expect(manager.createPack({ name: 'Other Pack', packageNames: ['alpha'] })).rejects.toThrow('整合包操作进行中')
    release()
    await first
  })
})

// ---------------------------------------------------------------------------
// importPack
// ---------------------------------------------------------------------------

describe('importPack', () => {
  it('离线分支：有 plugin-bodies 的 zip → local-directory 目标指向解压目录', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome)
    const { manager } = makeManager(env, stub, store)

    const bodyRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-pack-body-'))
    const alphaDir = path.join(bodyRoot, 'alpha')
    await mkdir(alphaDir, { recursive: true })
    await writeFile(path.join(alphaDir, 'package.json'), JSON.stringify({ name: 'alpha', version: '1.0.0' }))

    const manifest: PackManifest = {
      name: 'Offline Pack',
      description: 'offline',
      version: '1.0.0',
      plugins: [{ packageName: 'alpha', source: 'npm' }],
    }
    const zipPath = await writeZip(env, 'offline-pack.zip', manifest, new Map([['alpha', alphaDir]]))

    const result = await manager.importPack(zipPath)
    expect(result.installed).toEqual(['alpha'])
    expect(result.failures).toEqual([])
    expect(stub.installPluginTarget).toHaveBeenCalledTimes(1)

    const target = stub.installPluginTarget.mock.calls[0][0] as PackInstallTarget
    expect(target.source).toBe('local-directory')
    expect(target.profileName).toBe('pack-offline-pack')
    expect(target.packageName).toBe('alpha')
    expect(target.localDirectory).toBeDefined()
    expect(target.localDirectory!.startsWith(os.tmpdir())).toBe(true)
    expect(path.basename(target.localDirectory!)).toBe('alpha')

    await rm(bodyRoot, { recursive: true, force: true })
  })

  it('联网分支：manifest-only 包 → github 源目标', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome)
    const { manager } = makeManager(env, stub, store)

    const manifest: PackManifest = {
      name: 'Online Pack',
      description: 'online',
      version: '1.0.0',
      plugins: [{ packageName: 'beta', repository: 'demo/beta', source: 'github' }],
    }
    const zipPath = await writeZip(env, 'online-pack.zip', manifest, new Map())

    const result = await manager.importPack(zipPath)
    expect(result.installed).toEqual(['beta'])
    expect(result.state).toBe('complete')
    const target = stub.installPluginTarget.mock.calls[0][0] as PackInstallTarget
    expect(target.source).toBe('github')
    expect(target.repository).toBe('demo/beta')
    expect(target.profileName).toBe('pack-online-pack')
  })

  it('指定 items 且缺 body 时回落到 manifest-only 来源', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome)
    const { manager } = makeManager(env, stub, store)

    const bodyRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-pack-body-'))
    const alphaDir = path.join(bodyRoot, 'alpha')
    await mkdir(alphaDir, { recursive: true })
    await writeFile(path.join(alphaDir, 'package.json'), JSON.stringify({ name: 'alpha' }))

    const manifest: PackManifest = {
      name: 'Mixed',
      description: 'mixed',
      version: '1.0.0',
      plugins: [
        { packageName: 'alpha', source: 'npm' },
        { packageName: 'beta', repository: 'demo/beta', source: 'github' },
      ],
    }
    const zipPath = await writeZip(env, 'mixed.zip', manifest, new Map([['alpha', alphaDir]]))

    const result = await manager.importPack(zipPath, ['beta'])
    expect(result.installed).toEqual(['beta'])
    const target = stub.installPluginTarget.mock.calls[0][0] as PackInstallTarget
    expect(target.source).toBe('github')
    expect(target.repository).toBe('demo/beta')

    await rm(bodyRoot, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// analyzeImport
// ---------------------------------------------------------------------------

describe('analyzeImport', () => {
  it('有 body 的包：按 bodyPackageNames 列出，offline = true', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome)
    const { manager } = makeManager(env, stub, store)

    const bodyRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-pack-body-'))
    const alphaDir = path.join(bodyRoot, 'alpha')
    await mkdir(alphaDir, { recursive: true })
    await writeFile(path.join(alphaDir, 'package.json'), JSON.stringify({ name: 'alpha' }))

    const manifest: PackManifest = {
      name: 'An',
      description: 'a',
      version: '1.0.0',
      plugins: [{ packageName: 'alpha', source: 'npm' }],
    }
    const zipPath = await writeZip(env, 'an.zip', manifest, new Map([['alpha', alphaDir]]))

    const analysis = await manager.analyzeImport(zipPath)
    expect(analysis.id).toBe('pack-an')
    expect(analysis.source).toBe('zip')
    expect(analysis.items).toEqual([{ packageName: 'alpha', available: true, offline: true }])
    await rm(bodyRoot, { recursive: true, force: true })
  })

  it('manifest-only 缺 repository 且非 npm 源标不可用', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome)
    const { manager } = makeManager(env, stub, store)

    const plugin: PackPluginEntry = { packageName: 'broken', source: 'github' }
    const manifest: PackManifest = {
      name: 'An',
      description: 'a',
      version: '1.0.0',
      plugins: [plugin],
    }
    const zipPath = await writeZip(env, 'an.zip', manifest, new Map())

    const analysis = await manager.analyzeImport(zipPath)
    expect(analysis.source).toBe('manifest')
    expect(analysis.items).toEqual([{
      packageName: 'broken',
      available: false,
      offline: false,
      reason: '缺少来源仓库，无法联网安装',
    }])
  })
})

// ---------------------------------------------------------------------------
// activate / deactivate
// ---------------------------------------------------------------------------

describe('activatePack / deactivatePack', () => {
  it('activatePack 切到 pack profile，deactivatePack 回到默认 profile', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome, 'web')
    const { manager } = makeManager(env, stub, store)
    await upsertPackRecord(env.registryPath, recordFor('pack-x'))

    const activated = await manager.activatePack('pack-x')
    expect(activated.profileName).toBe('pack-x')
    expect(store.current.profileName).toBe('pack-x')

    const deactivated = await manager.deactivatePack()
    expect(deactivated.profileName).toBe('web')
    expect(store.current.profileName).toBe('web')
  })

  it('activatePack 对不存在的包抛错', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome)
    const { manager } = makeManager(env, stub, store)
    await expect(manager.activatePack('pack-ghost')).rejects.toThrow('整合包不存在')
  })
})

// ---------------------------------------------------------------------------
// removePack
// ---------------------------------------------------------------------------

describe('removePack', () => {
  it('当前启用时先 deactivate，再逐个 remove 插件并删除注册表记录', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    stub.readProfile.mockResolvedValue({
      ...defaultProfile,
      plugins: [managedPlugin('alpha'), managedPlugin('beta')],
    })
    const store = makeSettings(env.dshHome, 'pack-x')
    const { manager } = makeManager(env, stub, store)
    await upsertPackRecord(env.registryPath, recordFor('pack-x', [
      { packageName: 'alpha', enabled: true },
      { packageName: 'beta', enabled: true },
    ]))

    const result = await manager.removePack('pack-x')
    expect(result.removed).toBe(2)
    expect(store.current.profileName).toBe('web')
    expect(stub.remove).toHaveBeenCalledWith('alpha', 'pack-x')
    expect(stub.remove).toHaveBeenCalledWith('beta', 'pack-x')
    expect(await readPackRegistry(env.registryPath)).toEqual([])
  })

  it('未启用时跳过 deactivate', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    stub.readProfile.mockResolvedValue({ ...defaultProfile, plugins: [] })
    const store = makeSettings(env.dshHome, 'web')
    const { manager } = makeManager(env, stub, store)
    await upsertPackRecord(env.registryPath, recordFor('pack-x'))

    const result = await manager.removePack('pack-x')
    expect(result.removed).toBe(0)
    expect(store.current.profileName).toBe('web')
    expect(store.saveSettings).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// togglePackItem / removePackItem
// ---------------------------------------------------------------------------

describe('togglePackItem / removePackItem', () => {
  it('togglePackItem 调用 togglePlugin 并更新注册表 enabled', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome)
    const { manager } = makeManager(env, stub, store)
    await upsertPackRecord(env.registryPath, recordFor('pack-x', [{ packageName: 'alpha', enabled: false }]))

    const status = await manager.togglePackItem('pack-x', 'alpha', true)
    expect(stub.togglePlugin).toHaveBeenCalledWith(env.dshHome, 'pack-x', 'alpha', true)
    expect(status.plugins.find(p => p.packageName === 'alpha')?.enabled).toBe(true)
  })

  it('removePackItem 调用 remove 并从注册表移除插件', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome)
    const { manager } = makeManager(env, stub, store)
    await upsertPackRecord(env.registryPath, recordFor('pack-x', [{ packageName: 'alpha', enabled: true }]))

    const status = await manager.removePackItem('pack-x', 'alpha')
    expect(stub.remove).toHaveBeenCalledWith('alpha', 'pack-x')
    expect(status.plugins).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// listPacks
// ---------------------------------------------------------------------------

describe('listPacks', () => {
  it('按当前 profile 标记 enabled', async () => {
    const env = await makeEnv()
    const stub = makeInstallerStub()
    const store = makeSettings(env.dshHome, 'pack-one')
    const { manager } = makeManager(env, stub, store)
    await upsertPackRecord(env.registryPath, recordFor('pack-one'))
    await upsertPackRecord(env.registryPath, recordFor('pack-two'))

    const statuses = await manager.listPacks()
    expect(statuses.find(status => status.id === 'pack-one')?.enabled).toBe(true)
    expect(statuses.find(status => status.id === 'pack-two')?.enabled).toBe(false)
  })
})
