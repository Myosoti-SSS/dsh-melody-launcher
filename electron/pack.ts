// 整合包（Pack）管理的组装层。
//
// 职责：把底层模块（manifest / zip / export / registry / orchestration /
// installer 适配器）编排成渲染层可用的 PackManager。本模块不直接依赖
// Electron —— 对话框与「写用户选择的文件」由 ipc 层负责；DSH 插件的安装 /
// 卸载 / profile 读取全部委托给注入的 installer 适配器（main.ts 组装真实
// Installer，测试注入 stub）。

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_PROFILE_NAME } from '../src/constants'
import type {
  AppSettings,
  ApplicationInstallRequest,
  InstalledApplicationAddon,
  InstalledPreset,
  InstalledSkill,
  PackAnalysis,
  PackAnalysisItem,
  PackCreateRequest,
  PackImportOptions,
  PackInstallResult,
  PackInstalledApplication,
  PackInstalledPlugin,
  PackInstalledPreset,
  PackInstalledSkill,
  PackPluginEntry,
  PackProgressEvent,
  PackStatus,
  PluginInstallTarget,
  PresetInstallRequest,
  PresetInstallResult,
  ProfileState,
  SkillInstallRequest,
  SkillInstallResult,
  SkillInstallTarget,
} from '../src/types'
import { assertMeaningfulPackName, buildManifestFromReceipts, packProfileName } from './pack-manifest'
import { extractPackBodiesFromPath, extractPresetBodiesFromPath, findManifestInArchiveFromPath, inspectPackZipFromPath } from './pack-zip'
import { cleanPackNameHint, extractRawPluginBodiesFromPath, extractRawPresetSourcesFromPath, extractRawSkillSourcesFromPath, scanRawPackZipFromPath, type ExtractByteBudget } from './pack-scan'
import { buildPackExportToFile } from './pack-export'
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
import { readPresetReceipts, removePresetReceipt, type PresetInstallReceipt } from './preset-receipts'
import { readSkillReceipts, removeSkillReceipt, type SkillInstallReceipt } from './skill-receipts'
import { createProfileSnapshot, restoreProfileSnapshot, type ProfileSnapshot } from './ai-install'
import { isSafePackageName, isSafeProfileName } from './profile'

/** 扩展 PluginInstallTarget：携带 GitHub 仓库名，供 github / npm 源重建安装目标。 */
export type PackInstallTarget = PluginInstallTarget & { repository?: string }

/** pack 管理器依赖的最小 installer 面（main.ts 组装真实 Installer，测试注入 stub）。 */
export interface InstallInstaller {
  installPluginTarget(target: PackInstallTarget): Promise<unknown>
  /** raw 整合包导入的技能：从本地源目录/单文件全局安装到 dshHome/skills。 */
  installSkillLocal(dshHome: string, skill: { name: string; format: 'bundle' | 'flat'; sourceDir: string }): Promise<unknown>
  /** 从仓库安装一个 Skill（标准清单导入用）。 */
  installSkill(request: SkillInstallRequest): Promise<SkillInstallResult>
  /** 按固定 pin 安装一个 Skill（标准清单导入用，不重新分析 HEAD）。 */
  installSkillPinned(request: { repository: string; target: SkillInstallTarget }): Promise<InstalledSkill>
  /** 启用或停用一个本地 Skill。 */
  toggleSkill(name: string, enabled: boolean): Promise<InstalledSkill[]>
  /** 安装一个 Agent 预设（全局安装到 DSH 预设目录）。 */
  installPreset(request: PresetInstallRequest): Promise<PresetInstallResult>
  /** 从本地 staging 目录安装 Agent 预设（raw 整合包导入用）。 */
  installPresetLocal(dshHome: string, preset: { name: string; sourceDir: string }): Promise<unknown>
  /** 启用或停用一个本地 Agent 预设。 */
  togglePreset(name: string, enabled: boolean): Promise<InstalledPreset[]>
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
  /** Agent 预设安装凭据文件路径。 */
  presetReceiptsPath: string
  /** Skill 安装凭据文件路径。 */
  skillReceiptsPath: string
  /** Application Addon 管理器（用于读取/安装/卸载应用加载项）。 */
  applicationAddons: {
    list(): Promise<InstalledApplicationAddon[]>
    install(request: ApplicationInstallRequest): Promise<unknown>
    uninstall(id: string): Promise<InstalledApplicationAddon[]>
    toggle?(id: string, enabled: boolean): Promise<InstalledApplicationAddon[]>
  }
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
  exportPack(packId: string): Promise<{ zipPath: string; fileName: string }>
  activatePack(packId: string): Promise<AppSettings>
  deactivatePack(): Promise<AppSettings>
  removePack(packId: string): Promise<{ removed: number }>
  rollback(): Promise<{ restored: number; profileName: string }>
  hasSnapshot(): Promise<boolean>
  addPackPlugin(packId: string, packageName: string): Promise<PackStatus>
  addPackPreset(packId: string, presetName: string): Promise<PackStatus>
  addPackSkill(packId: string, skillName: string): Promise<PackStatus>
  addPackApplication(packId: string, addonId: string): Promise<PackStatus>
  togglePackItem(packId: string, packageName: string, enabled: boolean): Promise<PackStatus>
  togglePackPreset(packId: string, presetName: string, enabled: boolean): Promise<PackStatus>
  togglePackSkill(packId: string, skillName: string, enabled: boolean): Promise<PackStatus>
  togglePackApplication(packId: string, addonId: string, enabled: boolean): Promise<PackStatus>
  removePackItem(packId: string, packageName: string): Promise<PackStatus>
  removePackPreset(packId: string, presetName: string): Promise<PackStatus>
  removePackSkill(packId: string, skillName: string): Promise<PackStatus>
  removePackApplication(packId: string, addonId: string): Promise<PackStatus>
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
        const presetReceipts = await readPresetReceipts(options.presetReceiptsPath)
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

        // 预设是全局资源，创建自建包时它们已经安装；这里只把有来源记录的可导出预设纳入包。
        const installedPresets: string[] = []
        const presetReceiptsForPack: PresetInstallReceipt[] = []
        for (const presetName of request.presetNames ?? []) {
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(presetName)) {
            skippedFailures.push({ packageName: presetName, reason: '预设名称非法。' })
            continue
          }
          const receipt = presetReceipts.find(item => item.name === presetName)
          if (!receipt) {
            skippedFailures.push({ packageName: presetName, reason: '预设无来源记录，无法加入整合包' })
            continue
          }
          installedPresets.push(presetName)
          presetReceiptsForPack.push(receipt)
        }

        // Skill 与 Application 同样只纳入已存在且有来源/安装记录的资源。
        const skillReceipts = await readSkillReceipts(options.skillReceiptsPath)
        const installedSkills: string[] = []
        const skillReceiptsForPack: SkillInstallReceipt[] = []
        for (const skillName of request.skillNames ?? []) {
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
            skippedFailures.push({ packageName: skillName, reason: 'Skill 名称非法。' })
            continue
          }
          const receipt = skillReceipts.find(item => item.name === skillName)
          if (!receipt) {
            skippedFailures.push({ packageName: skillName, reason: 'Skill 无来源记录，无法加入整合包' })
            continue
          }
          installedSkills.push(skillName)
          skillReceiptsForPack.push(receipt)
        }

        const applicationAddons = await options.applicationAddons.list()
        const installedApplications: string[] = []
        const applicationAddonsForPack: InstalledApplicationAddon[] = []
        for (const addonId of request.applicationIds ?? []) {
          const addon = applicationAddons.find(item => item.id === addonId)
          if (!addon) {
            skippedFailures.push({ packageName: addonId, reason: '未找到已安装的应用加载项' })
            continue
          }
          installedApplications.push(addonId)
          applicationAddonsForPack.push(addon)
        }

        // 建 pack profile 目录，消除 DSH CLI 首次 add 的竞态。
        await mkdir(path.join(dshHome, 'profiles', packId), { recursive: true })

        options.emitEvent({ kind: 'status', message: `正在创建整合包「${request.name}」…` })
        snapshot = await createProfileSnapshot(dshHome, packId, options.snapshotRoot)
        options.emitEvent({ kind: 'snapshot' })

        const { installed: installedPlugins, failures } = await runSerialInstall(items, { emitEvent: options.emitEvent })
        const installed = [...installedPlugins, ...installedPresets, ...installedSkills, ...installedApplications]
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
          plugins: toInstalledPlugins(installedPlugins),
          ...(installedPresets.length > 0 ? { presets: installedPresets.map(name => ({ name, enabled: true })) } : {}),
          ...(installedSkills.length > 0 ? { skills: installedSkills.map(name => ({ name, format: skillReceiptsForPack.find(r => r.name === name)?.format ?? 'bundle', enabled: true })) } : {}),
          ...(installedApplications.length > 0 ? { applications: installedApplications.map(id => ({ id, name: applicationAddonsForPack.find(a => a.id === id)?.name ?? id, enabled: true })) } : {}),
          failures: result.failures.length > 0 ? result.failures : undefined,
        }
        await upsertPackRecord(options.registryPath, record)
        const extraParts: string[] = []
        if (installedPresets.length > 0) extraParts.push(`${installedPresets.length} 个预设`)
        if (installedSkills.length > 0) extraParts.push(`${installedSkills.length} 个技能`)
        if (installedApplications.length > 0) extraParts.push(`${installedApplications.length} 个应用`)
        log('success', `整合包「${request.name}」已创建：${installedPlugins.length} 个插件${extraParts.length > 0 ? `、${extraParts.join('、')}` : ''}。`)
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
      const manifestText = await findManifestInArchiveFromPath(filePath)
      if (!manifestText) {
        // 非标准包：扫描包内的标准插件目录与技能，合成为我们格式的整合包。
        const scan = await scanRawPackZipFromPath(filePath)
        const nameHint = cleanPackNameHint(path.basename(filePath)) ?? cleanPackNameHint(scan.topName ?? '') ?? ''
        const items: PackAnalysisItem[] = []
        for (const plugin of scan.plugins) {
          items.push({ packageName: plugin.packageName, available: true, offline: true })
        }
        for (const skill of scan.skills) {
          items.push({ packageName: skill.name, available: true, offline: true, kind: 'skill' })
        }
        for (const preset of scan.presets) {
          items.push({ packageName: preset.name, available: true, offline: true, kind: 'preset' })
        }
        for (const skippedItem of scan.skipped) {
          items.push({ packageName: skippedItem.entryPrefix, available: false, offline: false, reason: skippedItem.reason })
        }
        return {
          id: nameHint ? packProfileName(nameHint) : '',
          name: nameHint,
          description: `非标准整合包：扫描到 ${scan.plugins.length} 个插件、${scan.skills.length} 个技能${scan.presets.length > 0 ? `、${scan.presets.length} 个预设` : ''}。`,
          version: '1.0.0',
          source: 'raw',
          items,
        }
      }
      const inspection = await inspectPackZipFromPath(filePath)
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
      for (const preset of manifest.presets ?? []) {
        const offline = inspection.presetBodyNames.includes(preset.name)
        const available = offline || Boolean(preset.repository && preset.sourcePath && preset.revision)
        items.push({
          packageName: preset.name,
          available,
          offline,
          kind: 'preset',
          reason: available ? undefined : '缺少仓库/来源路径/版本，无法联网安装',
        })
      }
      for (const skill of manifest.skills ?? []) {
        const available = Boolean(skill.repository && skill.sourcePath && skill.revision)
        items.push({
          packageName: skill.name,
          available,
          offline: false,
          kind: 'skill',
          reason: available ? undefined : '缺少仓库/来源路径/版本，无法联网安装',
        })
      }
      for (const application of manifest.applications ?? []) {
        items.push({
          packageName: application.id,
          available: true,
          offline: false,
          kind: 'application',
        })
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
      let presetStaging: string | null = null
      let presetBodiesDir: string | null = null
      try {
        // 不再整体读入内存：先探测清单，再按分支用文件路径流式解析。
        // 文件被并发删除/移动时（通过 IPC stat 门禁后）这里会抛错，
        // 也能走 catch → finally 复位 active，避免整合包子系统永久卡在「进行中」。
        const manifestText = await findManifestInArchiveFromPath(filePath)
        if (!manifestText) {
          // ---- raw 分支：扫描非标准包内的插件与技能，离线安装，注册为我们格式的整合包。----
          const scan = await scanRawPackZipFromPath(filePath)
          if (scan.plugins.length === 0 && scan.skills.length === 0 && scan.presets.length === 0) {
            throw new Error('未在压缩包内发现可安装的插件、技能或预设。')
          }
          const nameHint = cleanPackNameHint(path.basename(filePath)) ?? cleanPackNameHint(scan.topName ?? '') ?? ''
          const packName = (importOptions?.name ?? '').trim() || nameHint
          if (!packName) throw new Error('无法确定整合包名称，请在预览中手动命名。')
          const packId = assertMeaningfulPackName(packName)

          const existing = await readPackRegistry(options.registryPath)
          if (existing.some(record => record.id === packId)) throw new Error('整合包已存在。')

          const dshHome = await getDshHome()
          // items 缺省 = 全装；插件名、技能名、预设名各自独立过滤（理论上可能撞名）。
          const wantedPlugins = scan.plugins.filter(plugin => !items || items.includes(plugin.packageName))
          const wantedSkills = scan.skills.filter(skill => !items || items.includes(skill.name))
          const wantedPresets = scan.presets.filter(preset => !items || items.includes(preset.name))

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
            const bodies = await extractRawPluginBodiesFromPath(filePath, wantedPlugins, bodiesDir, undefined, extractBudget)
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
            const sources = await extractRawSkillSourcesFromPath(filePath, wantedSkills, skillStaging, undefined, extractBudget)
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

          // 预设解到 dshHome 内 staging，再逐项全局安装到 .agent-presets。
          if (wantedPresets.length > 0) {
            presetStaging = await mkdtemp(path.join(dshHome, '.pack-raw-preset-staging-'))
            const sources = await extractRawPresetSourcesFromPath(filePath, wantedPresets, presetStaging, undefined, extractBudget)
            for (const preset of wantedPresets) {
              const sourceDir = sources.get(preset.name)
              if (!sourceDir) {
                installables.push({ packageName: preset.name, offline: true, install: async () => { throw new Error('预设来源解出失败。') } })
                continue
              }
              installables.push({ packageName: preset.name, offline: true, install: async () => { await options.installer.installPresetLocal(dshHome, { name: preset.name, sourceDir }) } })
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
          const installedPresets: PackInstalledPreset[] = wantedPresets
            .filter(preset => installed.includes(preset.name))
            .map(preset => ({ name: preset.name, enabled: true }))

          const record: PackRecord = {
            id: packId,
            name: packName,
            description: `非标准整合包：扫描到 ${scan.plugins.length} 个插件、${scan.skills.length} 个技能${scan.presets.length > 0 ? `、${scan.presets.length} 个预设` : ''}。`,
            version: '1.0.0',
            source: 'raw',
            installedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            state: result.state,
            plugins: toInstalledPlugins(installedPluginNames),
            skills: installedSkills,
            ...(installedPresets.length > 0 ? { presets: installedPresets } : {}),
            failures: result.failures.length > 0 ? result.failures : undefined,
          }
          await upsertPackRecord(options.registryPath, record)
          log('success', `非标准整合包「${packName}」已导入：${installed.length} 项。`)
          options.emitEvent({ kind: 'done', result })
          return result
        }

        const inspection = await inspectPackZipFromPath(filePath)
        const manifest = inspection.manifest
        const packId = packProfileName(manifest.name)

        const existing = await readPackRegistry(options.registryPath)
        if (existing.some(record => record.id === packId)) throw new Error('整合包已存在。')

        const dshHome = await getDshHome()
        await mkdir(path.join(dshHome, 'profiles', packId), { recursive: true })

        // 决定要安装的包名集合：显式 items 优先，否则有 body 按 body，否则按 manifest。
        // 插件 / 技能 / 预设 / 应用是独立资源，分开处理。
        const requested = items && items.length > 0 ? items : undefined
        const manifestEntries = new Map(manifest.plugins.map(entry => [entry.packageName, entry]))
        const presetEntries = new Map((manifest.presets ?? []).map(entry => [entry.name, entry]))
        const skillEntries = new Map((manifest.skills ?? []).map(entry => [entry.name, entry]))
        const applicationEntries = new Map((manifest.applications ?? []).map(entry => [entry.id, entry]))
        const presetNames = new Set(presetEntries.keys())
        const skillNames = new Set(skillEntries.keys())
        const applicationIds = new Set(applicationEntries.keys())

        const requestedItems = requested ?? []
        const requestedSet = requested ? new Set(requestedItems) : null
        const wantedPlugins = requestedSet
          ? requestedItems.filter(name => !presetNames.has(name) && !skillNames.has(name) && !applicationIds.has(name))
          : inspection.hasBodies
            ? inspection.bodyPackageNames
            : manifest.plugins.map(entry => entry.packageName)
        const wantedPresets = requestedSet
          ? requestedItems.filter(name => presetNames.has(name))
          : [...presetNames]
        const wantedSkills = requestedSet
          ? requestedItems.filter(name => skillNames.has(name))
          : [...skillNames]
        const wantedApplications = requestedSet
          ? requestedItems.filter(name => applicationIds.has(name))
          : [...applicationIds]

        const installables: InstallableItem[] = []

        options.emitEvent({ kind: 'status', message: `正在导入整合包「${manifest.name}」…` })
        snapshot = await createProfileSnapshot(dshHome, packId, options.snapshotRoot)
        options.emitEvent({ kind: 'snapshot' })

        if (inspection.hasBodies) {
          // 本体解到 pack profile 内的持久目录：DSH 通过 file: 引用它，任务结束后不得删除。
          const bodiesDir = packBodiesDir(dshHome, packId)
          await rm(bodiesDir, { recursive: true, force: true }).catch(() => undefined)
          const knownNames = new Set(manifest.plugins.map(entry => entry.packageName))
          const bodies = await extractPackBodiesFromPath(filePath, bodiesDir, undefined, knownNames)
          for (const packageName of wantedPlugins) {
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
          for (const packageName of wantedPlugins) {
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

        // Agent 预设：优先用包内 preset-bodies 离线安装，否则按清单 pin 联网安装。
        presetBodiesDir = path.join(dshHome, '.pack-preset-bodies', packId)
        await rm(presetBodiesDir, { recursive: true, force: true }).catch(() => undefined)
        const presetBodies = await extractPresetBodiesFromPath(filePath, presetBodiesDir)
        for (const presetName of wantedPresets) {
          const preset = presetEntries.get(presetName)!
          const bodyDir = presetBodies.get(presetName)
          if (bodyDir) {
            installables.push({
              packageName: presetName,
              offline: true,
              install: async () => { await options.installer.installPresetLocal(dshHome, { name: presetName, sourceDir: bodyDir }) },
            })
            continue
          }
          if (!preset.repository || !preset.sourcePath || !preset.revision) {
            installables.push({ packageName: presetName, install: async () => { throw new Error('清单中缺少该预设的来源信息') } })
            continue
          }
          installables.push({
            packageName: presetName,
            offline: false,
            install: async () => {
              await options.installer.installPreset({
                repository: preset.repository!,
                targetId: presetName,
                name: presetName,
                sourcePath: preset.sourcePath!,
                revision: preset.revision!,
              })
            },
          })
        }

        // Skill：按清单里的 pin 信息直接安装，不重新分析 HEAD。
        for (const skillName of wantedSkills) {
          const skill = skillEntries.get(skillName)!
          if (!skill.repository || !skill.sourcePath || !skill.revision) {
            installables.push({ packageName: skillName, install: async () => { throw new Error('清单中缺少该 Skill 的来源信息') } })
            continue
          }
          installables.push({
            packageName: skillName,
            offline: false,
            install: async () => {
              await options.installer.installSkillPinned({
                repository: skill.repository!,
                target: {
                  id: `${skillName}:${skill.sourcePath}`,
                  name: skillName,
                  description: '',
                  sourcePath: skill.sourcePath!,
                  format: skill.format,
                  revision: skill.revision!,
                  modelInvocable: false,
                  userInvocable: false,
                },
              })
            },
          })
        }

        // Application Addon：按仓库重新分析安装（暂不支持离线本体）。
        for (const addonId of wantedApplications) {
          const application = applicationEntries.get(addonId)!
          installables.push({
            packageName: addonId,
            offline: false,
            install: async () => {
              await options.applicationAddons.install({
                repository: application.repository,
                defaultBranch: 'main',
                targetId: application.id,
              })
            },
          })
        }

        const { installed, failures } = await runSerialInstall(installables, { emitEvent: options.emitEvent })
        const result = buildInstallResult(packId, installed, failures)

        const installedPluginNames = installed.filter(name => !presetNames.has(name) && !skillNames.has(name) && !applicationIds.has(name))
        const installedPresetNames = installed.filter(name => presetNames.has(name))
        const installedSkillNames = installed.filter(name => skillNames.has(name))
        const installedApplicationIds = installed.filter(name => applicationIds.has(name))
        const record: PackRecord = {
          id: packId,
          name: manifest.name,
          description: manifest.description,
          version: manifest.version,
          source: inspection.hasBodies ? 'zip' : 'manifest',
          installedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          state: result.state,
          plugins: toInstalledPlugins(installedPluginNames),
          ...(installedPresetNames.length > 0 ? { presets: installedPresetNames.map(name => ({ name, enabled: true })) } : {}),
          ...(installedSkillNames.length > 0 ? { skills: installedSkillNames.map(name => ({ name, format: skillEntries.get(name)?.format ?? 'bundle', enabled: true })) } : {}),
          ...(installedApplicationIds.length > 0 ? { applications: installedApplicationIds.map(id => ({ id, name: applicationEntries.get(id)?.name ?? id, enabled: true })) } : {}),
          failures: result.failures.length > 0 ? result.failures : undefined,
        }
        await upsertPackRecord(options.registryPath, record)
        const extraParts: string[] = []
        if (installedPresetNames.length > 0) extraParts.push(`${installedPresetNames.length} 个预设`)
        if (installedSkillNames.length > 0) extraParts.push(`${installedSkillNames.length} 个技能`)
        if (installedApplicationIds.length > 0) extraParts.push(`${installedApplicationIds.length} 个应用`)
        log('success', `整合包「${manifest.name}」已导入：${installedPluginNames.length} 个插件${extraParts.length > 0 ? `、${extraParts.join('、')}` : ''}。`)
        options.emitEvent({ kind: 'done', result })
        return result
      } catch (error) {
        const message = asErrorMessage(error)
        options.emitEvent({ kind: 'error', message })
        throw error
      } finally {
        if (skillStaging) await rm(skillStaging, { recursive: true, force: true }).catch(() => undefined)
        if (presetStaging) await rm(presetStaging, { recursive: true, force: true }).catch(() => undefined)
        if (presetBodiesDir) await rm(presetBodiesDir, { recursive: true, force: true }).catch(() => undefined)
        active = false
      }
    },

    async exportPack(packId) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      active = true
      let exportDir: string | null = null
      try {
        const record = await findRecord(packId)
        const dshHome = await getDshHome()
        const receipts = (await readPluginReceipts(options.pluginReceiptsPath))
          .filter(item => item.profileName === packId)
        const presetNames = new Set((record.presets ?? []).map(preset => preset.name))
        const presetReceipts = (await readPresetReceipts(options.presetReceiptsPath))
          .filter(item => presetNames.has(item.name))
        const skillNames = new Set((record.skills ?? []).map(skill => skill.name))
        const skillReceipts = (await readSkillReceipts(options.skillReceiptsPath))
          .filter(item => skillNames.has(item.name))
        const applicationIds = new Set((record.applications ?? []).map(addon => addon.id))
        const applicationAddons = (await options.applicationAddons.list())
          .filter(addon => applicationIds.has(addon.id))
        const manifest = buildManifestFromReceipts(packId, receipts, presetReceipts, skillReceipts, applicationAddons)
        // 只收集 manifest 引用的插件本体：profile 里可能混入无来源记录的手动安装插件，不应进包。
        const packageNames = manifest.plugins.map(entry => entry.packageName)
        // 预设本体也打进 zip：换机导入时可完全离线安装。
        const presetDirs = new Map<string, string>()
        for (const preset of record.presets ?? []) {
          const dir = path.join(dshHome, '.agent-presets', preset.name)
          if (existsSync(dir)) presetDirs.set(preset.name, dir)
        }
        const packProfileDir = path.join(dshHome, 'profiles', packId)
        const exportRoot = path.join(options.snapshotRoot, 'exports')
        await mkdir(exportRoot, { recursive: true })
        exportDir = await mkdtemp(path.join(exportRoot, 'pack-'))
        const zipPath = path.join(exportDir, `${packId}.zip`)
        const { missing } = await buildPackExportToFile(packProfileDir, manifest, packageNames, zipPath, presetDirs)
        if (missing.length > 0) {
          log('info', `导出整合包「${packId}」时 ${missing.length} 个插件本体缺失（${missing.join('、')}），将导出为仅清单。`)
        }
        return { zipPath, fileName: `${packId}.zip` }
      } catch (error) {
        if (exportDir) await rm(exportDir, { recursive: true, force: true }).catch(() => undefined)
        throw error
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
          await removeSkillReceipt(options.skillReceiptsPath, skill.name).catch(() => undefined)
        }
        // Agent 预设同样全局安装：仅当没有其它包引用同名预设时才删除目录与 receipt。
        const presetRoot = path.join(dshHome, '.agent-presets')
        for (const preset of record.presets ?? []) {
          const stillReferenced = remaining.some(other => (other.presets ?? []).some(item => item.name === preset.name))
          if (stillReferenced) continue
          await rm(path.join(presetRoot, preset.name), { recursive: true, force: true }).catch(() => undefined)
          await rm(path.join(presetRoot, '.disabled', preset.name), { recursive: true, force: true }).catch(() => undefined)
          await removePresetReceipt(options.presetReceiptsPath, preset.name).catch(() => undefined)
        }
        // Application Addon：仅当没有其它包引用时卸载。
        for (const addon of record.applications ?? []) {
          const stillReferenced = remaining.some(other => (other.applications ?? []).some(item => item.id === addon.id))
          if (stillReferenced) continue
          try {
            await options.applicationAddons.uninstall(addon.id)
          } catch (error) {
            log('error', `卸载应用加载项 ${addon.id} 失败：${asErrorMessage(error)}`)
          }
        }
        return {
          removed: profile.plugins.length
            + (record.presets?.length ?? 0)
            + (record.skills?.length ?? 0)
            + (record.applications?.length ?? 0),
        }
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

    async addPackPreset(packId, presetName) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      beginTask()
      try {
        assertSafePackId(packId)
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(presetName)) throw new Error('预设名称无效。')
        const settings = await options.readSettings()
        const receipts = await readPresetReceipts(options.presetReceiptsPath)
        const receipt = receipts.find(item => item.name === presetName)
        if (!receipt) throw new Error('当前环境找不到该预设的来源记录。')
        const record = await findRecord(packId)
        if (record.presets?.some(item => item.name === presetName)) {
          return toPackStatus(record, settings.profileName)
        }
        const presets = [...(record.presets ?? []), { name: presetName, enabled: true }]
        const updated: PackRecord = { ...record, presets, updatedAt: new Date().toISOString() }
        await upsertPackRecord(options.registryPath, updated)
        return toPackStatus(updated, settings.profileName)
      } finally {
        active = false
      }
    },

    async addPackSkill(packId, skillName) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      beginTask()
      try {
        assertSafePackId(packId)
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) throw new Error('Skill 名称无效。')
        const settings = await options.readSettings()
        const receipts = await readSkillReceipts(options.skillReceiptsPath)
        const receipt = receipts.find(item => item.name === skillName)
        if (!receipt) throw new Error('当前环境找不到该 Skill 的来源记录。')
        const record = await findRecord(packId)
        if (record.skills?.some(item => item.name === skillName)) {
          return toPackStatus(record, settings.profileName)
        }
        const skills = [...(record.skills ?? []), { name: skillName, format: receipt.format, enabled: true }]
        const updated: PackRecord = { ...record, skills, updatedAt: new Date().toISOString() }
        await upsertPackRecord(options.registryPath, updated)
        return toPackStatus(updated, settings.profileName)
      } finally {
        active = false
      }
    },

    async togglePackSkill(packId, skillName, enabled) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      beginTask()
      try {
        assertSafePackId(packId)
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) throw new Error('Skill 名称无效。')
        const settings = await options.readSettings()
        await options.installer.toggleSkill(skillName, Boolean(enabled))
        const record = await findRecord(packId)
        const skills = (record.skills ?? []).map(item => item.name === skillName ? { ...item, enabled: Boolean(enabled) } : item)
        const updated: PackRecord = { ...record, skills, updatedAt: new Date().toISOString() }
        await upsertPackRecord(options.registryPath, updated)
        return toPackStatus(updated, settings.profileName)
      } finally {
        active = false
      }
    },

    async removePackSkill(packId, skillName) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      beginTask()
      try {
        assertSafePackId(packId)
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) throw new Error('Skill 名称无效。')
        const settings = await options.readSettings()
        const record = await findRecord(packId)
        const skills = (record.skills ?? []).filter(item => item.name !== skillName)
        const updated: PackRecord = { ...record, skills: skills.length > 0 ? skills : undefined, updatedAt: new Date().toISOString() }
        await upsertPackRecord(options.registryPath, updated)
        const remaining = await readPackRegistry(options.registryPath)
        const stillReferenced = remaining.some(other => (other.skills ?? []).some(item => item.name === skillName))
        if (!stillReferenced) {
          const dshHome = await getDshHome()
          const skillRoot = path.join(dshHome, 'skills')
          const removed = (record.skills ?? []).find(item => item.name === skillName)
          if (removed?.format === 'flat') {
            await rm(path.join(skillRoot, `${skillName}.md`), { recursive: true, force: true }).catch(() => undefined)
            await rm(path.join(skillRoot, '.disabled', `${skillName}.md`), { recursive: true, force: true }).catch(() => undefined)
          } else {
            await rm(path.join(skillRoot, skillName), { recursive: true, force: true }).catch(() => undefined)
            await rm(path.join(skillRoot, '.disabled', skillName), { recursive: true, force: true }).catch(() => undefined)
          }
          await removeSkillReceipt(options.skillReceiptsPath, skillName).catch(() => undefined)
        }
        return toPackStatus(updated, settings.profileName)
      } finally {
        active = false
      }
    },

    async addPackApplication(packId, addonId) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      beginTask()
      try {
        assertSafePackId(packId)
        const settings = await options.readSettings()
        const addons = await options.applicationAddons.list()
        const addon = addons.find(item => item.id === addonId)
        if (!addon) throw new Error('当前环境找不到已安装的应用加载项。')
        const record = await findRecord(packId)
        if (record.applications?.some(item => item.id === addonId)) {
          return toPackStatus(record, settings.profileName)
        }
        const applications = [...(record.applications ?? []), { id: addonId, name: addon.name, enabled: true }]
        const updated: PackRecord = { ...record, applications, updatedAt: new Date().toISOString() }
        await upsertPackRecord(options.registryPath, updated)
        return toPackStatus(updated, settings.profileName)
      } finally {
        active = false
      }
    },

    async togglePackApplication(packId, addonId, enabled) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      beginTask()
      try {
        assertSafePackId(packId)
        const settings = await options.readSettings()
        if (options.applicationAddons.toggle) {
          await options.applicationAddons.toggle(addonId, Boolean(enabled))
        }
        const record = await findRecord(packId)
        const applications = (record.applications ?? []).map(item => item.id === addonId ? { ...item, enabled: Boolean(enabled) } : item)
        const updated: PackRecord = { ...record, applications, updatedAt: new Date().toISOString() }
        await upsertPackRecord(options.registryPath, updated)
        return toPackStatus(updated, settings.profileName)
      } finally {
        active = false
      }
    },

    async removePackApplication(packId, addonId) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      beginTask()
      try {
        assertSafePackId(packId)
        const settings = await options.readSettings()
        const record = await findRecord(packId)
        const applications = (record.applications ?? []).filter(item => item.id !== addonId)
        const updated: PackRecord = { ...record, applications: applications.length > 0 ? applications : undefined, updatedAt: new Date().toISOString() }
        await upsertPackRecord(options.registryPath, updated)
        const remaining = await readPackRegistry(options.registryPath)
        const stillReferenced = remaining.some(other => (other.applications ?? []).some(item => item.id === addonId))
        if (!stillReferenced) {
          try {
            await options.applicationAddons.uninstall(addonId)
          } catch (error) {
            log('error', `卸载应用加载项 ${addonId} 失败：${asErrorMessage(error)}`)
          }
        }
        return toPackStatus(updated, settings.profileName)
      } finally {
        active = false
      }
    },

    async togglePackPreset(packId, presetName, enabled) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      beginTask()
      try {
        assertSafePackId(packId)
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(presetName)) throw new Error('预设名称无效。')
        const settings = await options.readSettings()
        await options.installer.togglePreset(presetName, Boolean(enabled))
        const record = await findRecord(packId)
        const presets = (record.presets ?? []).map(item => item.name === presetName ? { ...item, enabled: Boolean(enabled) } : item)
        const updated: PackRecord = { ...record, presets, updatedAt: new Date().toISOString() }
        await upsertPackRecord(options.registryPath, updated)
        return toPackStatus(updated, settings.profileName)
      } finally {
        active = false
      }
    },

    async removePackPreset(packId, presetName) {
      const reason = guarded()
      if (reason) throw new Error(reason)
      beginTask()
      try {
        assertSafePackId(packId)
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(presetName)) throw new Error('预设名称无效。')
        const settings = await options.readSettings()
        const record = await findRecord(packId)
        const presets = (record.presets ?? []).filter(item => item.name !== presetName)
        const updated: PackRecord = { ...record, presets: presets.length > 0 ? presets : undefined, updatedAt: new Date().toISOString() }
        await upsertPackRecord(options.registryPath, updated)
        // 若没有其它包再引用该预设，则同步清理全局目录与 receipt（与 removePack 语义一致）。
        const remaining = await readPackRegistry(options.registryPath)
        const stillReferenced = remaining.some(other => (other.presets ?? []).some(item => item.name === presetName))
        if (!stillReferenced) {
          const dshHome = await getDshHome()
          const presetRoot = path.join(dshHome, '.agent-presets')
          await rm(path.join(presetRoot, presetName), { recursive: true, force: true }).catch(() => undefined)
          await rm(path.join(presetRoot, '.disabled', presetName), { recursive: true, force: true }).catch(() => undefined)
          await removePresetReceipt(options.presetReceiptsPath, presetName).catch(() => undefined)
        }
        return toPackStatus(updated, settings.profileName)
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
