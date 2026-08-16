// 整合包（Pack）管理的组装层。
//
// 职责：把底层模块（manifest / zip / export / registry / orchestration /
// installer 适配器）编排成渲染层可用的 PackManager。本模块不直接依赖
// Electron —— 对话框与「写用户选择的文件」由 ipc 层负责；DSH 插件的安装 /
// 卸载 / profile 读取全部委托给注入的 installer 适配器（main.ts 组装真实
// Installer，测试注入 stub）。

import os from 'node:os'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_PROFILE_NAME } from '../src/constants'
import type {
  AppSettings,
  PackAnalysis,
  PackAnalysisItem,
  PackCreateRequest,
  PackInstallResult,
  PackInstalledPlugin,
  PackPluginEntry,
  PackProgressEvent,
  PackStatus,
  PluginInstallTarget,
  ProfileState,
} from '../src/types'
import { buildManifestFromReceipts, packProfileName } from './pack-manifest'
import { extractPackBodies, inspectPackZip } from './pack-zip'
import { buildPackExport } from './pack-export'
import {
  readPackRegistry,
  removePackRecord,
  toPackStatus,
  upsertPackRecord,
  type PackRecord,
} from './pack-registry'
import {
  buildInstallResult,
  guardPackStart,
  runSerialInstall,
  type InstallableItem,
} from './pack-orchestration'
import { readPluginReceipts, type PluginInstallReceipt } from './plugin-receipts'
import { createProfileSnapshot, restoreProfileSnapshot, type ProfileSnapshot } from './ai-install'
import { isSafePackageName, isSafeProfileName } from './profile'

/** 扩展 PluginInstallTarget：携带 GitHub 仓库名，供 github / npm 源重建安装目标。 */
export type PackInstallTarget = PluginInstallTarget & { repository?: string }

/** pack 管理器依赖的最小 installer 面（main.ts 组装真实 Installer，测试注入 stub）。 */
export interface InstallInstaller {
  installPluginTarget(target: PackInstallTarget): Promise<unknown>
  remove(packageName: string, profileName?: string): Promise<unknown>
  readProfile(dshHome: string, profileName: string): Promise<ProfileState>
  togglePlugin(dshHome: string, profileName: string, packageName: string, enabled: boolean): Promise<ProfileState>
}

export interface PackManagerOptions {
  readSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<AppSettings>
  /** packs.json 注册表路径。 */
  registryPath: string
  /** 快照落盘目录（对齐 ai-install）。 */
  snapshotRoot: string
  /** 插件安装凭据文件路径。 */
  pluginReceiptsPath: string
  installer: InstallInstaller
  emitOutput?: (level: 'info' | 'error' | 'success', text: string) => void
  emitEvent: (event: PackProgressEvent) => void
  isRuntimeRunning: () => boolean
  isInstallerBusy: () => boolean
  /** 覆盖 DSH_HOME；缺省从 settings 读取。 */
  dshHome?: string
}

export interface PackManager {
  listPacks(): Promise<PackStatus[]>
  isBusy(): boolean
  createPack(request: PackCreateRequest): Promise<PackInstallResult>
  analyzeImport(filePath: string): Promise<PackAnalysis>
  importPack(filePath: string, items?: string[]): Promise<PackInstallResult>
  exportPack(packId: string): Promise<{ zip: Uint8Array; fileName: string }>
  activatePack(packId: string): Promise<AppSettings>
  deactivatePack(): Promise<AppSettings>
  removePack(packId: string): Promise<{ removed: number }>
  rollback(): Promise<{ restored: number; profileName: string }>
  hasSnapshot(): Promise<boolean>
  addPackPlugin(packId: string, packageName: string): Promise<PackStatus>
  togglePackItem(packId: string, packageName: string, enabled: boolean): Promise<PackStatus>
  removePackItem(packId: string, packageName: string): Promise<PackStatus>
}

/** 离线导入解出 plugin-bodies 用的临时目录前缀。 */
const IMPORT_WORKDIR_PREFIX = 'dsh-pack-import-'

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : '未知错误'
}

function assertSafePackId(packId: string): void {
  if (typeof packId !== 'string' || !isSafeProfileName(packId)) throw new Error('整合包标识无效。')
}

export function createPackManager(options: PackManagerOptions): PackManager {
  let active = false
  let snapshot: ProfileSnapshot | null = null

  const getDshHome = async (): Promise<string> => options.dshHome || (await options.readSettings()).dshHome

  const log = (level: 'info' | 'error' | 'success', text: string): void => {
    options.emitOutput?.(level, text)
  }

  /** receipt → 可安装 target。local 源缺本地路径无法重建，返回 null。 */
  function receiptToTarget(receipt: PluginInstallReceipt, packId: string): PackInstallTarget | null {
    if (receipt.source === 'local-directory') return null
    const source: 'npm' | 'github' = receipt.source === 'npm' ? 'npm' : 'github'
    const target: PackInstallTarget = {
      id: receipt.packageName,
      packageName: receipt.packageName,
      version: receipt.version ?? '0.0.0',
      source,
      profileName: packId,
      platform: 'unknown',
      subdirectory: receipt.subdirectory,
      commit: receipt.commit,
      requiresBuild: false,
      buildScripts: [],
      nodeRange: null,
    }
    // github 与 npm 源都需要仓库名才能重建安装目标（npm 已发布包也由该仓库承载）。
    target.repository = receipt.repository
    return target
  }

  /** manifest 插件条目 → 可安装 target。source 非 npm 且无 repository 时无法联网安装，返回 null。 */
  function manifestEntryToTarget(entry: PackPluginEntry | undefined, packId: string): PackInstallTarget | null {
    if (!entry || !isSafePackageName(entry.packageName)) return null
    const source: 'npm' | 'github' = entry.source === 'npm' ? 'npm' : 'github'
    const target: PackInstallTarget = {
      id: entry.packageName,
      packageName: entry.packageName,
      version: entry.version ?? null,
      source,
      profileName: packId,
      platform: 'unknown',
      subdirectory: entry.subdirectory ?? null,
      commit: entry.commit ?? '',
      requiresBuild: false,
      buildScripts: [],
      nodeRange: null,
    }
    if (source === 'github') {
      if (!entry.repository) return null
      target.repository = entry.repository
    }
    return target
  }

  function guarded(): string | null {
    return guardPackStart({
      isRuntimeRunning: options.isRuntimeRunning,
      isInstallerBusy: options.isInstallerBusy,
      isPackBusy: () => active,
    })
  }

  async function findRecord(packId: string): Promise<PackRecord> {
    assertSafePackId(packId)
    const records = await readPackRegistry(options.registryPath)
    const record = records.find(item => item.id === packId)
    if (!record) throw new Error('整合包不存在。')
    return record
  }

  function toInstalledPlugins(installed: string[]): PackInstalledPlugin[] {
    return installed.map(packageName => ({ packageName, enabled: true }))
  }

  return {
    async listPacks() {
      const settings = await options.readSettings()
      const records = await readPackRegistry(options.registryPath)
      return records.map(record => toPackStatus(record, settings.profileName))
    },

    isBusy: () => active,

    async createPack(request) {
      const reason = guarded()
      if (reason) throw new Error(reason)

      const packId = packProfileName(request.name)
      const existing = await readPackRegistry(options.registryPath)
      if (existing.some(record => record.id === packId)) throw new Error('整合包已存在。')

      const settings = await options.readSettings()
      const dshHome = await getDshHome()
      const profileName = settings.profileName
      // 确认当前 profile 可读（顺带校验 profile 名），安装来源仍以 receipt 为准。
      await options.installer.readProfile(dshHome, profileName)

      const receipts = await readPluginReceipts(options.pluginReceiptsPath)
      const items: InstallableItem[] = []
      const skippedFailures: { packageName: string; reason: string }[] = []
      for (const packageName of request.packageNames) {
        if (!isSafePackageName(packageName)) {
          skippedFailures.push({ packageName, reason: '插件名称非法。' })
          continue
        }
        const receipt = receipts.find(item => item.profileName === profileName && item.packageName === packageName)
        if (!receipt) {
          skippedFailures.push({ packageName, reason: '无来源记录，无法重新安装' })
          continue
        }
        const target = receiptToTarget(receipt, packId)
        if (!target) {
          skippedFailures.push({ packageName, reason: '本地目录来源的插件缺少来源路径，无法重新安装' })
          continue
        }
        items.push({ packageName, install: async () => { await options.installer.installPluginTarget(target) } })
      }

      // 建 pack profile 目录，消除 DSH CLI 首次 add 的竞态。
      await mkdir(path.join(dshHome, 'profiles', packId), { recursive: true })

      active = true
      try {
        options.emitEvent({ kind: 'status', message: `正在创建整合包「${request.name}」…` })
        snapshot = await createProfileSnapshot(dshHome, packId, options.snapshotRoot)
        options.emitEvent({ kind: 'snapshot' })

        const { installed, failures } = await runSerialInstall(items, { emitEvent: options.emitEvent })
        const allFailures = [...skippedFailures, ...failures]
        const result = buildInstallResult(packId, installed, allFailures)

        const record: PackRecord = {
          id: packId,
          name: request.name,
          description: request.description ?? '',
          version: '1.0.0',
          source: 'created',
          installedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          state: result.state,
          plugins: toInstalledPlugins(installed),
        }
        await upsertPackRecord(options.registryPath, record)
        log('success', `整合包「${request.name}」已创建：${installed.length} 个插件。`)
        options.emitEvent({ kind: 'done', result })
        return result
      } catch (error) {
        const message = asErrorMessage(error)
        options.emitEvent({ kind: 'error', message })
        throw error
      } finally {
        active = false
      }
    },

    async analyzeImport(filePath) {
      const buffer = new Uint8Array(await readFile(filePath))
      const inspection = inspectPackZip(buffer)
      const manifest = inspection.manifest
      const packId = packProfileName(manifest.name)

      const items: PackAnalysisItem[] = []
      if (inspection.hasBodies) {
        // 有 plugin-bodies：按 body 包名逐项列出（全部可离线安装）。
        for (const packageName of inspection.bodyPackageNames) {
          items.push(isSafePackageName(packageName)
            ? { packageName, available: true, offline: true }
            : { packageName, available: false, offline: false, reason: '插件名称非法。' })
        }
      } else {
        // manifest-only：按 manifest.plugins 逐项列出；缺 repository 且非 npm 源标不可用。
        for (const entry of manifest.plugins) {
          if (!isSafePackageName(entry.packageName)) {
            items.push({ packageName: entry.packageName, available: false, offline: false, reason: '插件名称非法。' })
            continue
          }
          const available = entry.source === 'npm' || Boolean(entry.repository)
          items.push(available
            ? { packageName: entry.packageName, available: true, offline: false }
            : { packageName: entry.packageName, available: false, offline: false, reason: '缺少来源仓库，无法联网安装' })
        }
      }
      return {
        id: packId,
        name: manifest.name,
        description: manifest.description,
        version: manifest.version,
        source: inspection.hasBodies ? 'zip' : 'manifest',
        items,
      }
    },

    async importPack(filePath, items) {
      const reason = guarded()
      if (reason) throw new Error(reason)

      const buffer = new Uint8Array(await readFile(filePath))
      const inspection = inspectPackZip(buffer)
      const manifest = inspection.manifest
      const packId = packProfileName(manifest.name)

      const existing = await readPackRegistry(options.registryPath)
      if (existing.some(record => record.id === packId)) throw new Error('整合包已存在。')

      const dshHome = await getDshHome()
      await mkdir(path.join(dshHome, 'profiles', packId), { recursive: true })

      // 决定要安装的包名集合：显式 items 优先，否则有 body 按 body，否则按 manifest。
      const requested = items && items.length > 0 ? items : undefined
      const bodyNames = new Set(inspection.bodyPackageNames)
      const manifestEntries = new Map(manifest.plugins.map(entry => [entry.packageName, entry]))
      let wanted: string[]
      if (requested) {
        wanted = requested
      } else if (inspection.hasBodies) {
        wanted = inspection.bodyPackageNames
      } else {
        wanted = manifest.plugins.map(entry => entry.packageName)
      }

      const installables: InstallableItem[] = []
      let workDir: string | null = null

      active = true
      try {
        options.emitEvent({ kind: 'status', message: `正在导入整合包「${manifest.name}」…` })
        snapshot = await createProfileSnapshot(dshHome, packId, options.snapshotRoot)
        options.emitEvent({ kind: 'snapshot' })

        if (inspection.hasBodies) {
          workDir = await mkdtemp(path.join(os.tmpdir(), IMPORT_WORKDIR_PREFIX))
          const bodies = await extractPackBodies(buffer, workDir)
          for (const packageName of wanted) {
            if (!isSafePackageName(packageName)) {
              installables.push({ packageName, install: async () => { throw new Error('插件名称非法。') } })
              continue
            }
            const bodyDir = bodies.get(packageName)
            if (bodyDir) {
              const target: PackInstallTarget = {
                id: packageName,
                packageName,
                version: null,
                source: 'local-directory',
                profileName: packId,
                platform: 'unknown',
                subdirectory: null,
                commit: '',
                requiresBuild: false,
                buildScripts: [],
                nodeRange: null,
                localDirectory: bodyDir,
              }
              installables.push({ packageName, offline: true, install: async () => { await options.installer.installPluginTarget(target) } })
            } else {
              const target = manifestEntryToTarget(manifestEntries.get(packageName), packId)
              if (target) {
                installables.push({ packageName, offline: false, install: async () => { await options.installer.installPluginTarget(target) } })
              } else {
                installables.push({ packageName, offline: false, install: async () => { throw new Error('清单中缺少该插件的来源，无法联网安装') } })
              }
            }
          }
        } else {
          for (const packageName of wanted) {
            if (!isSafePackageName(packageName)) {
              installables.push({ packageName, install: async () => { throw new Error('插件名称非法。') } })
              continue
            }
            const target = manifestEntryToTarget(manifestEntries.get(packageName), packId)
            if (target) {
              installables.push({ packageName, offline: false, install: async () => { await options.installer.installPluginTarget(target) } })
            } else {
              installables.push({ packageName, offline: false, install: async () => { throw new Error('清单中缺少该插件的来源，无法联网安装') } })
            }
          }
        }

        const { installed, failures } = await runSerialInstall(installables, { emitEvent: options.emitEvent })
        const result = buildInstallResult(packId, installed, failures)

        const record: PackRecord = {
          id: packId,
          name: manifest.name,
          description: manifest.description,
          version: manifest.version,
          source: inspection.hasBodies ? 'zip' : 'manifest',
          installedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          state: result.state,
          plugins: toInstalledPlugins(installed),
        }
        await upsertPackRecord(options.registryPath, record)
        log('success', `整合包「${manifest.name}」已导入：${installed.length} 个插件。`)
        options.emitEvent({ kind: 'done', result })
        return result
      } catch (error) {
        const message = asErrorMessage(error)
        options.emitEvent({ kind: 'error', message })
        throw error
      } finally {
        active = false
        if (workDir) {
          await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
        }
      }
    },

    async exportPack(packId) {
      await findRecord(packId)
      const dshHome = await getDshHome()
      const receipts = (await readPluginReceipts(options.pluginReceiptsPath))
        .filter(item => item.profileName === packId)
      const manifest = buildManifestFromReceipts(packId, receipts)
      const profile = await options.installer.readProfile(dshHome, packId)
      const packageNames = profile.plugins.map(plugin => plugin.packageName)
      const packProfileDir = path.join(dshHome, 'profiles', packId)
      const { zip, missing } = await buildPackExport(packProfileDir, manifest, packageNames)
      if (missing.length > 0) {
        log('info', `导出整合包「${packId}」时 ${missing.length} 个插件本体缺失（${missing.join('、')}），将导出为仅清单。`)
      }
      return { zip, fileName: `${packId}.zip` }
    },

    async activatePack(packId) {
      await findRecord(packId)
      const settings = await options.readSettings()
      if (settings.profileName === packId) return settings
      return options.saveSettings({ ...settings, profileName: packId })
    },

    async deactivatePack() {
      const settings = await options.readSettings()
      if (settings.profileName === DEFAULT_PROFILE_NAME) return settings
      return options.saveSettings({ ...settings, profileName: DEFAULT_PROFILE_NAME })
    },

    async removePack(packId) {
      const record = await findRecord(packId)
      const dshHome = await getDshHome()
      const settings = await options.readSettings()
      if (settings.profileName === packId) {
        await options.saveSettings({ ...settings, profileName: DEFAULT_PROFILE_NAME })
      }
      const profile = await options.installer.readProfile(dshHome, packId)
      for (const plugin of profile.plugins) {
        try {
          await options.installer.remove(plugin.packageName, packId)
        } catch (error) {
          log('error', `移除插件 ${plugin.packageName} 失败：${asErrorMessage(error)}`)
        }
      }
      // 尽力清理 profile 目录（DSH CLI 可能正在占用部分文件）。
      await rm(path.join(dshHome, 'profiles', packId), { recursive: true, force: true }).catch(() => undefined)
      await removePackRecord(options.registryPath, packId)
      void record
      return { removed: profile.plugins.length }
    },

    async rollback() {
      if (!snapshot) throw new Error('没有可用快照，无法还原。')
      const result = await restoreProfileSnapshot(snapshot)
      const profile = await options.installer.readProfile(snapshot.dshHome, snapshot.profileName)
      // 本次新建 profile 且还原后仍未初始化 → 连目录一起删掉。
      if (!profile.initialized) {
        await rm(path.join(snapshot.dshHome, 'profiles', snapshot.profileName), { recursive: true, force: true }).catch(() => undefined)
      }
      options.emitEvent({ kind: 'status', message: `已还原快照 ${snapshot.id}` })
      return { restored: result.restored, profileName: snapshot.profileName }
    },

    hasSnapshot: async () => snapshot !== null,

    async addPackPlugin(packId, packageName) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      assertSafePackId(packId)
      if (!isSafePackageName(packageName)) throw new Error('插件名称无效。')

      const settings = await options.readSettings()
      const dshHome = await getDshHome()
      const receipts = await readPluginReceipts(options.pluginReceiptsPath)
      const receipt = receipts.find(item => item.profileName === settings.profileName && item.packageName === packageName)
      if (!receipt) throw new Error('当前 Profile 中找不到该插件的来源记录。')
      const target = receiptToTarget(receipt, packId)
      if (!target) throw new Error('本地目录来源的插件无法加入整合包。')

      await mkdir(path.join(dshHome, 'profiles', packId), { recursive: true })

      active = true
      try {
        await options.installer.installPluginTarget(target)
        const record = await findRecord(packId)
        const plugins = [...record.plugins.filter(item => item.packageName !== packageName), { packageName, enabled: true }]
        const updated: PackRecord = { ...record, plugins, updatedAt: new Date().toISOString() }
        await upsertPackRecord(options.registryPath, updated)
        return toPackStatus(updated, settings.profileName)
      } catch (error) {
        options.emitEvent({ kind: 'error', message: asErrorMessage(error) })
        throw error
      } finally {
        active = false
      }
    },

    async togglePackItem(packId, packageName, enabled) {
      assertSafePackId(packId)
      if (!isSafePackageName(packageName)) throw new Error('插件名称无效。')
      const dshHome = await getDshHome()
      const settings = await options.readSettings()
      await options.installer.togglePlugin(dshHome, packId, packageName, Boolean(enabled))
      const record = await findRecord(packId)
      const plugins = record.plugins.map(item => item.packageName === packageName ? { ...item, enabled: Boolean(enabled) } : item)
      const updated: PackRecord = { ...record, plugins, updatedAt: new Date().toISOString() }
      await upsertPackRecord(options.registryPath, updated)
      return toPackStatus(updated, settings.profileName)
    },

    async removePackItem(packId, packageName) {
      assertSafePackId(packId)
      if (!isSafePackageName(packageName)) throw new Error('插件名称无效。')
      const settings = await options.readSettings()
      await options.installer.remove(packageName, packId)
      const record = await findRecord(packId)
      const plugins = record.plugins.filter(item => item.packageName !== packageName)
      const updated: PackRecord = { ...record, plugins, updatedAt: new Date().toISOString() }
      await upsertPackRecord(options.registryPath, updated)
      return toPackStatus(updated, settings.profileName)
    },
  }
}
