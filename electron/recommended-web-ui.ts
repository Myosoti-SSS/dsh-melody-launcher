import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppSettings } from '../src/types'
import type { Installer } from './installer'
import { readProfile, updateBundles } from './profile'

/**
 * 「官方推荐整合包」DSH Web UI 全家桶：安装 latest、启用、可选停用其它插件、
 * 并把皮肤切到官方默认外观。
 */

/** 官方推荐整合包：DSH Web UI 全家桶。 */
export const RECOMMENDED_WEB_UI_PACKAGE = '@linxin666/dsh-web-ui-all'

/** 核心组合层：始终保留，不参与“停用其它插件”。 */
const CORE_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless'])

/**
 * 皮肤中心的“当前活动皮肤”文件。active 为空串 = 官方默认外观：
 * skin-center 的 seed 逻辑只在 active 为 null/缺失时强写回作者默认皮肤，
 * 非空 id（哪怕是空串）会被尊重，从而持久保持默认外观。
 */
const STOCK_ACTIVE_SKIN = { active: '' }

export interface RecommendedWebUiOptions {
  readSettings: () => Promise<AppSettings>
  installer: Installer
}

export interface RecommendedWebUiStatus {
  installed: boolean
  enabled: boolean
}

export interface RecommendedWebUiService {
  isBusy(): boolean
  status(): Promise<RecommendedWebUiStatus>
  ensureInstall(options: { suspendOthers?: boolean }): Promise<RecommendedWebUiStatus>
}

async function activeSkinStatePath(dshHome: string): Promise<string> {
  return path.join(dshHome, 'skin-center-active.json')
}

async function writeStockActiveSkin(dshHome: string): Promise<void> {
  try {
    const target = await activeSkinStatePath(dshHome)
    await mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.dsh-launcher.tmp`
    await writeFile(temporary, `${JSON.stringify(STOCK_ACTIVE_SKIN, null, 2)}\n`, 'utf8')
    try {
      await rename(temporary, target)
    } catch {
      await writeFile(target, `${JSON.stringify(STOCK_ACTIVE_SKIN, null, 2)}\n`, 'utf8')
      await unlink(temporary).catch(() => undefined)
    }
  } catch {
    // 皮肤文件写失败不阻断安装。
  }
}

export function createRecommendedWebUiService(options: RecommendedWebUiOptions): RecommendedWebUiService {
  let busy = false

  async function status(): Promise<RecommendedWebUiStatus> {
    const settings = await options.readSettings()
    const profile = await readProfile(settings.dshHome, settings.profileName)
    const plugin = profile.plugins.find(item => item.packageName === RECOMMENDED_WEB_UI_PACKAGE)
    return { installed: Boolean(plugin), enabled: plugin?.enabled ?? false }
  }

  async function ensureInstall(request: { suspendOthers?: boolean }): Promise<RecommendedWebUiStatus> {
    if (busy) throw new Error('官方推荐整合包安装正在进行，请稍候。')
    busy = true
    try {
      const settings = await options.readSettings()
      // 安装 latest 并自动启用（installer 自带 Bundle 校验与 receipt）。
      await options.installer.installNpmPackage({
        packageName: RECOMMENDED_WEB_UI_PACKAGE,
        version: 'latest',
        repository: 'recommended:dsh-web-ui',
      })
      // 老用户：先把其它非核心插件暂不启用，避免与全家桶兼容性冲突（可在启动项管理重新开启）。
      if (request.suspendOthers) {
        await updateBundles(settings.dshHome, settings.profileName, bundles =>
          bundles.filter(name => CORE_BUNDLES.has(name) || name === RECOMMENDED_WEB_UI_PACKAGE),
        )
      }
      await writeStockActiveSkin(settings.dshHome)
      return status()
    } finally {
      busy = false
    }
  }

  return { isBusy: () => busy, status, ensureInstall }
}