import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_PROFILE_NAME, DSH_PACKAGE_NAME } from '../src/constants'
import type { AppSettings, DshInstallationStatus } from '../src/types'
import { isSafeProfileName } from './profile'

/**
 * 启动器设置的唯一权威来源：默认值、校验、持久化与内存缓存。
 * 不直接依赖 electron —— 路径与 DSH 检测都由调用方注入，因此可以完整单测。
 */

export interface DefaultSettingsInput {
  /** 环境变量 DSH_HOME，缺省时回落到用户主目录下的 .dsh。 */
  dshHomeFromEnvironment?: string
  homeDirectory: string
  documentsDirectory: string
  /** 系统 npx 的绝对路径；未检测到时使用平台默认名。 */
  systemNpx?: string
  platform?: NodeJS.Platform
}

export function defaultSettings(input: DefaultSettingsInput): AppSettings {
  const platform = input.platform ?? process.platform
  return {
    dshHome: input.dshHomeFromEnvironment || path.join(input.homeDirectory, '.dsh'),
    profileName: DEFAULT_PROFILE_NAME,
    workspace: input.documentsDirectory,
    launchExecutable: input.systemNpx ?? (platform === 'win32' ? 'npx.cmd' : 'npx'),
    launchArgs: ['--yes', DSH_PACKAGE_NAME, 'web'],
    openAfterLaunch: true,
  }
}

/** 校验并归一化一份来自渲染层的设置。任何一项不合法都直接抛错。 */
export function validateSettings(input: AppSettings): AppSettings {
  if (!input || typeof input !== 'object') throw new Error('设置格式无效。')
  if (!isSafeProfileName(input.profileName)) throw new Error('配置名称只能包含字母、数字、点、横线或下划线。')
  if (!path.isAbsolute(input.dshHome) || !path.isAbsolute(input.workspace)) throw new Error('目录必须使用完整路径。')
  if (!input.launchExecutable.trim()) throw new Error('启动命令不能为空。')
  if (!Array.isArray(input.launchArgs) || input.launchArgs.some(value => typeof value !== 'string')) throw new Error('启动参数格式无效。')
  return {
    dshHome: input.dshHome,
    profileName: input.profileName,
    workspace: input.workspace,
    launchExecutable: input.launchExecutable.trim(),
    launchArgs: input.launchArgs,
    openAfterLaunch: Boolean(input.openAfterLaunch),
  }
}

/** 把磁盘上的设置合并到默认值上，丢弃结构不对的字段。 */
export function mergeStoredSettings(defaults: AppSettings, stored: Partial<AppSettings> | null): AppSettings {
  if (!stored || typeof stored !== 'object') return defaults
  return {
    ...defaults,
    ...stored,
    launchArgs: Array.isArray(stored.launchArgs)
      ? stored.launchArgs.filter(value => typeof value === 'string')
      : defaults.launchArgs,
  }
}

/**
 * 判断当前配置是否走「用 npx 临时拉取 DSH」的方式。
 * 是的话说明还没绑定到某个具体安装，可以在检测到本地 DSH 后自动切换过去。
 */
export function usesOnDemandDsh(settings: AppSettings): boolean {
  const executable = path.basename(settings.launchExecutable).toLowerCase()
  return (executable === 'npx' || executable === 'npx.cmd') && settings.launchArgs.includes(DSH_PACKAGE_NAME)
}

/** 已检测到本地 DSH 时，把按需拉取的配置切换为直接调用它。 */
export function adoptDetectedDsh(settings: AppSettings, detected: DshInstallationStatus): AppSettings {
  if (!usesOnDemandDsh(settings) || !detected.installed || !detected.executable) return settings
  return { ...settings, launchExecutable: detected.executable, launchArgs: ['web'] }
}

export interface SettingsStore {
  read(): Promise<AppSettings>
  save(input: AppSettings): Promise<AppSettings>
}

export interface SettingsStoreOptions {
  filePath: string
  createDefaults: () => AppSettings
  /** 首次读取时用于把按需拉取的配置绑定到已安装的 DSH。 */
  detectInstalledDsh: (configuredExecutable: string) => Promise<DshInstallationStatus>
}

export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
  let cache: AppSettings | null = null

  return {
    async read(): Promise<AppSettings> {
      if (cache) return cache
      const defaults = options.createDefaults()
      let stored: Partial<AppSettings> | null = null
      try {
        stored = JSON.parse(await readFile(options.filePath, 'utf8')) as Partial<AppSettings>
      } catch {
        stored = null
      }
      cache = mergeStoredSettings(defaults, stored)
      if (usesOnDemandDsh(cache)) {
        cache = adoptDetectedDsh(cache, await options.detectInstalledDsh(cache.launchExecutable))
      }
      return cache
    },

    async save(input: AppSettings): Promise<AppSettings> {
      const next = validateSettings(input)
      await mkdir(path.dirname(options.filePath), { recursive: true })
      await writeFile(options.filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      cache = next
      return next
    },
  }
}
