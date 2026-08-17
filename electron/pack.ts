// 整合包（Pack）管理的组装层。
//
// 职责：把底层模块（manifest / zip / export / registry / orchestration /
// installer 适配器）编排成渲染层可用的 PackManager。本模块不直接依赖
// Electron —— 对话框与「写用户选择的文件」由 ipc 层负责；DSH 插件的安装 /
// 卸载 / profile 读取全部委托给注入的 installer 适配器（main.ts 组装真实
// Installer，测试注入 stub）。

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_PROFILE_NAME } from '../src/constants'
import type {
  AppSettings,
  PackAnalysis,
  PackAnalysisItem,
  PackCreateRequest,
  PackImportOptions,
  PackInstallResult,
  PackInstalledPlugin,
  PackInstalledSkill,
  PackPluginEntry,
  PackProgressEvent,
  PackStatus,
  PluginInstallTarget,
  ProfileState,
} from '../src/types'
import { assertMeaningfulPackName, buildManifestFromReceipts, packProfileName } from './pack-manifest'
import { extractPackBodies, findManifestInArchive, inspectPackZip } from './pack-zip'
import { cleanPackNameHint, extractRawPluginBodies, extractRawSkillSources, scanRawPackZip, type ExtractByteBudget } from './pack-scan'
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
  /** raw 整合包导入的技能：从本地源目录/单文件全局安装到 dshHome/skills。 */
  installSkillLocal(dshHome: string, skill: { name: string; format: 'bundle' | 'flat'; sourceDir: string }): Promise<unknown>
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
  importPack(filePath: string, items?: string[], options?: PackImportOptions): Promise<PackInstallResult>
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
  /** 当前任务是否「新建了一个此前不存在的 pack profile」：回滚时据此决定删 profile 目录 + 注册表记录。 */
  let profileWasNew = false

  const getDshHome = async (): Promise<string> => options.dshHome || (await options.readSettings()).dshHome

  /** 离线导入的插件本体目录：持久落在 pack profile 内，避免安装后 file: 引用悬空。 */
  function packBodiesDir(dshHome: string, packId: string): string {
    return path.join(dshHome, 'profiles', packId, '.pack-bodies')
  }

  /** 新任务开始：占住互斥位、丢弃上一个任务的快照与「是否新建 profile」标记。 */
  function beginTask(): void {
    active = true
    snapshot = null
    profileWasNew = false
  }

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
      beginTask()
      profileWasNew = true
      try {
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
          failures: result.failures.length > 0 ? result.failures : undefined,
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
      const buffer = await readFile(filePath)
      if (!findManifestInArchive(buffer)) {
        // 非标准包：扫描包内的标准插件目录与技能，合成为我们格式的整合包。
        const scan = scanRawPackZip(buffer)
        const nameHint = cleanPackNameHint(path.basename(filePath)) ?? cleanPackNameHint(scan.topName ?? '') ?? ''
        const items: PackAnalysisItem[] = []
        for (const plugin of scan.plugins) {
          items.push({ packageName: plugin.packageName, available: true, offline: true })
        }
        for (const skill of scan.skills) {
          items.push({ packageName: skill.name, available: true, offline: true, kind: 'skill' })
        }
        for (const skippedItem of scan.skipped) {
          items.push({ packageName: skippedItem.entryPrefix, available: false, offline: false, reason: skippedItem.reason })
        }
        return {
          id: nameHint ? packProfileName(nameHint) : '',
          name: nameHint,
          description: `非标准整合包：扫描到 ${scan.plugins.length} 个插件、${scan.skills.length} 个技能。`,
          version: '1.0.0',
          source: 'raw',
          items,
        }
      }
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

    async importPack(filePath, items, importOptions) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      beginTask()
      profileWasNew = true
      let skillStaging: string | null = null
      try {
        // readFile 放在 try 内：文件被并发删除/移动时（通过 IPC stat 门禁后）若读失败，
        // 也能走 catch → finally 复位 active，避免整合包子系统永久卡在「进行中」。
        const buffer = await readFile(filePath)
        if (!findManifestInArchive(buffer)) {
          // ---- raw 分支：扫描非标准包内的插件与技能，离线安装，注册为我们格式的整合包。----
          const scan = scanRawPackZip(buffer)
          if (scan.plugins.length === 0 && scan.skills.length === 0) {
            throw new Error('未在压缩包内发现可安装的插件或技能。')
          }
          const nameHint = cleanPackNameHint(path.basename(filePath)) ?? cleanPackNameHint(scan.topName ?? '') ?? ''
          const packName = (importOptions?.name ?? '').trim() || nameHint
          if (!packName) throw new Error('无法确定整合包名称，请在预览中手动命名。')
          const packId = assertMeaningfulPackName(packName)

          const existing = await readPackRegistry(options.registryPath)
          if (existing.some(record => record.id === packId)) throw new Error('整合包已存在。')

          const dshHome = await getDshHome()
          // items 缺省 = 全装；插件名与技能名各自独立过滤（理论上可能撞名）。
          const wantedPlugins = scan.plugins.filter(plugin => !items || items.includes(plugin.packageName))
          const wantedSkills = scan.skills.filter(skill => !items || items.includes(skill.name))

          await mkdir(path.join(dshHome, 'profiles', packId), { recursive: true })
          options.emitEvent({ kind: 'status', message: `正在扫描并导入非标准整合包「${packName}」…` })
          snapshot = await createProfileSnapshot(dshHome, packId, options.snapshotRoot)
          options.emitEvent({ kind: 'snapshot' })

          const installables: InstallableItem[] = []

          // 插件与技能共用同一解压字节预算：2 GiB 上限按一次导入的累计解出字节封顶，
          // 防止被拆成多个候选各自「达标」而整体绕过（zip-bomb）。
          const extractBudget: ExtractByteBudget = { extracted: 0 }

          // 插件本体解到 pack profile 持久目录（file: 引用不悬空，对齐标准离线导入）。
          if (wantedPlugins.length > 0) {
            const bodiesDir = packBodiesDir(dshHome, packId)
            await rm(bodiesDir, { recursive: true, force: true }).catch(() => undefined)
            const bodies = await extractRawPluginBodies(buffer, wantedPlugins, bodiesDir, undefined, extractBudget)
            for (const plugin of wantedPlugins) {
              const bodyDir = bodies.get(plugin.packageName)
              if (!bodyDir) {
                installables.push({ packageName: plugin.packageName, offline: true, install: async () => { throw new Error('插件本体解出失败。') } })
                continue
              }
              const target: PackInstallTarget = {
                id: plugin.packageName,
                packageName: plugin.packageName,
                version: plugin.version ?? null,
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
              installables.push({ packageName: plugin.packageName, offline: true, install: async () => { await options.installer.installPluginTarget(target) } })
            }
          }

          // 技能解到 dshHome 内 staging（与 skills/ 同卷），逐项全局安装。
          if (wantedSkills.length > 0) {
            skillStaging = await mkdtemp(path.join(dshHome, '.pack-raw-staging-'))
            const sources = await extractRawSkillSources(buffer, wantedSkills, skillStaging, undefined, extractBudget)
            for (const skill of wantedSkills) {
              const sourceDir = sources.get(skill.name)
              if (!sourceDir) {
                installables.push({ packageName: skill.name, offline: true, install: async () => { throw new Error('技能来源解出失败。') } })
                continue
              }
              const skillInstall = { name: skill.name, format: skill.format, sourceDir }
              installables.push({ packageName: skill.name, offline: true, install: async () => { await options.installer.installSkillLocal(dshHome, skillInstall) } })
            }
          }

          const { installed, failures } = await runSerialInstall(installables, { emitEvent: options.emitEvent })
          const result = buildInstallResult(packId, installed, failures)

          const installedPluginNames = wantedPlugins
            .filter(plugin => installed.includes(plugin.packageName))
            .map(plugin => plugin.packageName)
          const installedSkills: PackInstalledSkill[] = wantedSkills
            .filter(skill => installed.includes(skill.name))
            .map(skill => ({ name: skill.name, format: skill.format, enabled: true }))

          const record: PackRecord = {
            id: packId,
            name: packName,
            description: `非标准整合包：扫描到 ${scan.plugins.length} 个插件、${scan.skills.length} 个技能。`,
            version: '1.0.0',
            source: 'raw',
            installedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            state: result.state,
            plugins: toInstalledPlugins(installedPluginNames),
            skills: installedSkills,
            failures: result.failures.length > 0 ? result.failures : undefined,
          }
          await upsertPackRecord(options.registryPath, record)
          log('success', `非标准整合包「${packName}」已导入：${installed.length} 项。`)
          options.emitEvent({ kind: 'done', result })
          return result
        }

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

        options.emitEvent({ kind: 'status', message: `正在导入整合包「${manifest.name}」…` })
        snapshot = await createProfileSnapshot(dshHome, packId, options.snapshotRoot)
        options.emitEvent({ kind: 'snapshot' })

        if (inspection.hasBodies) {
          // 本体解到 pack profile 内的持久目录：DSH 通过 file: 引用它，任务结束后不得删除。
          const bodiesDir = packBodiesDir(dshHome, packId)
          await rm(bodiesDir, { recursive: true, force: true }).catch(() => undefined)
          const knownNames = new Set(manifest.plugins.map(entry => entry.packageName))
          const bodies = await extractPackBodies(buffer, bodiesDir, undefined, knownNames)
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
          failures: result.failures.length > 0 ? result.failures : undefined,
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
        if (skillStaging) await rm(skillStaging, { recursive: true, force: true }).catch(() => undefined)
        active = false
      }
    },

    async exportPack(packId) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      active = true
      try {
        await findRecord(packId)
        const dshHome = await getDshHome()
        const receipts = (await readPluginReceipts(options.pluginReceiptsPath))
          .filter(item => item.profileName === packId)
        const manifest = buildManifestFromReceipts(packId, receipts)
        // 只收集 manifest 引用的插件本体：profile 里可能混入无来源记录的手动安装插件，不应进包。
        const packageNames = manifest.plugins.map(entry => entry.packageName)
        const packProfileDir = path.join(dshHome, 'profiles', packId)
        const { zip, missing } = await buildPackExport(packProfileDir, manifest, packageNames)
        if (missing.length > 0) {
          log('info', `导出整合包「${packId}」时 ${missing.length} 个插件本体缺失（${missing.join('、')}），将导出为仅清单。`)
        }
        return { zip, fileName: `${packId}.zip` }
      } finally {
        active = false
      }
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
      const reason = guarded()
      if (reason) throw new Error(reason)
      beginTask()
      try {
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
        // 尽力清理 profile 目录（含 .pack-bodies 本体；DSH CLI 可能正在占用部分文件）。
        await rm(path.join(dshHome, 'profiles', packId), { recursive: true, force: true }).catch(() => undefined)
        await removePackRecord(options.registryPath, packId)
        // 技能全局安装：仅当没有其它包引用同名技能时才删除（DSH 技能不随 profile 隔离）。
        const remaining = await readPackRegistry(options.registryPath)
        const skillRoot = path.join(dshHome, 'skills')
        for (const skill of record.skills ?? []) {
          const stillReferenced = remaining.some(other => (other.skills ?? []).some(item => item.name === skill.name))
          if (stillReferenced) continue
          // 只删本次包实际安装的形态（bundle 目录 或 flat 单 .md）：同名异形技能可能是
          // 用户自行从目录安装的独立技能，不能因为删包而无差别清除。
          if (skill.format === 'flat') {
            await rm(path.join(skillRoot, `${skill.name}.md`), { recursive: true, force: true }).catch(() => undefined)
            await rm(path.join(skillRoot, '.disabled', `${skill.name}.md`), { recursive: true, force: true }).catch(() => undefined)
          } else {
            await rm(path.join(skillRoot, skill.name), { recursive: true, force: true }).catch(() => undefined)
            await rm(path.join(skillRoot, '.disabled', skill.name), { recursive: true, force: true }).catch(() => undefined)
          }
        }
        return { removed: profile.plugins.length }
      } finally {
        active = false
      }
    },

    async rollback() {
      const reason = guarded()
      if (reason) throw new Error(reason)
      if (!snapshot) throw new Error('没有可用快照，无法还原。')
      active = true
      try {
        const result = await restoreProfileSnapshot(snapshot)
        const profile = await options.installer.readProfile(snapshot.dshHome, snapshot.profileName)
        // 本次新建 pack profile（create/import）→ 回滚 = 彻底撤销创建：删 profile 目录 + 注册表记录。
        if (profileWasNew || !profile.initialized) {
          await rm(path.join(snapshot.dshHome, 'profiles', snapshot.profileName), { recursive: true, force: true }).catch(() => undefined)
          await removePackRecord(options.registryPath, snapshot.profileName).catch(() => undefined)
        }
        options.emitEvent({ kind: 'status', message: `已还原快照 ${snapshot.id}` })
        return { restored: result.restored, profileName: snapshot.profileName }
      } finally {
        active = false
        snapshot = null
        profileWasNew = false
      }
    },

    hasSnapshot: async () => snapshot !== null,

    async addPackPlugin(packId, packageName) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      beginTask()
      profileWasNew = false
      try {
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

        options.emitEvent({ kind: 'status', message: `正在向整合包添加插件 ${packageName}…` })
        snapshot = await createProfileSnapshot(dshHome, packId, options.snapshotRoot)
        options.emitEvent({ kind: 'snapshot' })
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
      const reason = guarded()
      if (reason) throw new Error(reason)
      beginTask()
      try {
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
      } finally {
        active = false
      }
    },

    async removePackItem(packId, packageName) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      beginTask()
      try {
        assertSafePackId(packId)
        if (!isSafePackageName(packageName)) throw new Error('插件名称无效。')
        const dshHome = await getDshHome()
        const settings = await options.readSettings()
        await options.installer.remove(packageName, packId)
        // 清理该插件残留的离线本体目录（安装后引用已由 remove 断开，可安全删除）。
        await rm(path.join(packBodiesDir(dshHome, packId), ...packageName.split('/')), { recursive: true, force: true }).catch(() => undefined)
        const record = await findRecord(packId)
        const plugins = record.plugins.filter(item => item.packageName !== packageName)
        const updated: PackRecord = { ...record, plugins, updatedAt: new Date().toISOString() }
        await upsertPackRecord(options.registryPath, updated)
        return toPackStatus(updated, settings.profileName)
      } finally {
        active = false
      }
    },
  }
}
