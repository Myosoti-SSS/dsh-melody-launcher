// 整合包（Pack）清单的纯函数域：派生 Profile 名 / 解析校验 / 序列化 / 从安装凭据构建。
// 本模块不依赖 Electron 与 fs，便于单元测试；导出用序列化、导入用解析。
// 注意：v1 的 skills 字段与其它未知字段一律忽略（解析时跳过）。

import path from 'node:path'
import { parse, stringify } from 'yaml'
import type { PackManifest, PackPluginEntry } from '../src/types'
import { isSafePackageName, isSafeProfileName, isSafeRepositoryName } from './profile'
import type { PluginInstallReceipt } from './plugin-receipts'

/** 压缩包内的清单文件名（导出 / 导入共用）。 */
export const PACK_MANIFEST_FILENAME = 'dsh-pack.yaml'

const PACK_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/
const PACK_VERSION_RE = /^\d+\.\d+\.\d+/
const PACK_COMMIT_RE = /^[0-9a-f]{7,40}$/i
const PACK_DESCRIPTION_MAX = 500
const PACK_PROFILE_PREFIX = 'pack-'

/** 合法的分支名：非空、1-160 位、不含 ..，仅允许 URL 安全字符。 */
function safeBranch(value: string): boolean {
  return value.length > 0
    && value.length <= 160
    && !value.includes('..')
    && /^[A-Za-z0-9._/-]+$/.test(value)
}

/** commit 允许 7-40 位十六进制 SHA，或合法的分支名。 */
function safeCommit(value: string): boolean {
  return PACK_COMMIT_RE.test(value) || safeBranch(value)
}

/** subdirectory 不得含 .. 段 / 反斜杠 / 绝对路径 / 空段。 */
function safeSubdirectory(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.includes('\\') || path.posix.isAbsolute(value)) return false
  const segments = value.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return false
  const normalized = path.posix.normalize(value)
  return normalized !== '.' && normalized !== '..' && !normalized.startsWith('../')
}

/** 由整合包名称派生安全 Profile 名（含 pack- 前缀）。 */
export function packProfileName(name: string): string {
  if (!name || !name.trim()) throw new Error('整合包名称不能为空。')
  const derived = `${PACK_PROFILE_PREFIX}${name.toLowerCase().replace(/[^a-z0-9._-]/g, '-')}`
  if (!isSafeProfileName(derived)) throw new Error('整合包名称无法生成安全的 Profile 名。')
  return derived
}

function parsePackPlugin(item: unknown, index: number): PackPluginEntry {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    throw new Error(`plugins[${index}] 必须是映射（对象）。`)
  }
  const raw = item as Record<string, unknown>
  const packageName = raw.packageName
  if (typeof packageName !== 'string' || !isSafePackageName(packageName)) {
    throw new Error(`plugins[${index}] 的 packageName 缺失或格式非法。`)
  }
  const entry: PackPluginEntry = { packageName }
  if (raw.repository !== undefined) {
    if (typeof raw.repository !== 'string' || !isSafeRepositoryName(raw.repository)) {
      throw new Error(`plugins[${index}] 的 repository 格式非法。`)
    }
    entry.repository = raw.repository
  }
  if (raw.source !== undefined) {
    if (raw.source !== 'github' && raw.source !== 'npm' && raw.source !== 'local') {
      throw new Error(`plugins[${index}] 的 source 只能是 github / npm / local。`)
    }
    entry.source = raw.source
  }
  if (raw.subdirectory !== undefined) {
    if (typeof raw.subdirectory !== 'string' || !safeSubdirectory(raw.subdirectory)) {
      throw new Error(`plugins[${index}] 的 subdirectory 格式非法。`)
    }
    entry.subdirectory = raw.subdirectory
  }
  if (raw.commit !== undefined) {
    if (typeof raw.commit !== 'string' || !safeCommit(raw.commit)) {
      throw new Error(`plugins[${index}] 的 commit 格式非法。`)
    }
    entry.commit = raw.commit
  }
  if (raw.version !== undefined) {
    if (typeof raw.version !== 'string' || !PACK_VERSION_RE.test(raw.version)) {
      throw new Error(`plugins[${index}] 的 version 格式非法。`)
    }
    entry.version = raw.version
  }
  if (!entry.source) {
    // 缺省 source：有 repository 视为 github，否则 npm。
    entry.source = entry.repository ? 'github' : 'npm'
  }
  return entry
}

/** 解析并校验 dsh-pack.yaml 文本，非法时抛出含中文描述的错误。未知字段忽略。 */
export function parsePackManifest(text: string): PackManifest {
  let data: unknown
  try {
    data = parse(text)
  } catch (error) {
    throw new Error(`dsh-pack.yaml 不是合法的 YAML（${error instanceof Error ? error.message : String(error)}）。`)
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('dsh-pack.yaml 顶层必须是映射（对象）。')
  }
  const raw = data as Record<string, unknown>

  if (typeof raw.name !== 'string' || !PACK_NAME_RE.test(raw.name)) {
    throw new Error('整合包 name 缺失或非法（须以字母/数字开头，1-64 位，仅含字母、数字、._ 与空格）。')
  }
  if (typeof raw.description !== 'string' || raw.description.trim().length === 0 || raw.description.length > PACK_DESCRIPTION_MAX) {
    throw new Error(`整合包 description 缺失、为空或超过 ${PACK_DESCRIPTION_MAX} 字符。`)
  }
  if (typeof raw.version !== 'string' || !PACK_VERSION_RE.test(raw.version)) {
    throw new Error('整合包 version 缺失或非法（须为 semver，如 1.0.0）。')
  }
  if (!Array.isArray(raw.plugins)) {
    throw new Error('整合包 plugins 必须是数组。')
  }

  const manifest: PackManifest = {
    name: raw.name,
    description: raw.description,
    version: raw.version,
    plugins: raw.plugins.map((item, index) => parsePackPlugin(item, index)),
  }
  if (typeof raw.author === 'string' && raw.author) manifest.author = raw.author
  // skills 字段 v1 预留，这里忽略（未知字段一律忽略）。
  return manifest
}

/** 序列化 manifest 为 dsh-pack.yaml 文本（导出用）。 */
export function serializePackManifest(manifest: PackManifest): string {
  const output: Record<string, unknown> = {
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    plugins: manifest.plugins,
  }
  if (manifest.author) output.author = manifest.author
  if (manifest.skills !== undefined) output.skills = manifest.skills
  return stringify(output, { lineWidth: 0 })
}

function manifestNameFromPackId(packId: string): string {
  let name = packId.startsWith(PACK_PROFILE_PREFIX) ? packId.slice(PACK_PROFILE_PREFIX.length) : packId
  if (!name) name = 'pack'
  if (!/^[A-Za-z0-9]/.test(name)) name = `p${name}`
  if (name.length > 64) name = name.slice(0, 64)
  if (!PACK_NAME_RE.test(name)) throw new Error('packId 无法派生合法的整合包 name。')
  return name
}

function receiptToPluginEntry(receipt: PluginInstallReceipt): PackPluginEntry {
  const entry: PackPluginEntry = { packageName: receipt.packageName }
  if (receipt.source === 'github' || receipt.source === 'archive-subdirectory') {
    entry.source = 'github'
    if (receipt.repository) entry.repository = receipt.repository
    if (receipt.subdirectory) entry.subdirectory = receipt.subdirectory
    if (receipt.commit) entry.commit = receipt.commit
  } else if (receipt.source === 'local-directory') {
    // 离线 zip 导入的本体：来源映射为 local，导出时 body 会原样带上（联网安装方需要它）。
    entry.source = 'local'
    if (receipt.version) entry.version = receipt.version
  } else {
    entry.source = 'npm'
    if (receipt.version) entry.version = receipt.version
  }
  return entry
}

/** 从安装凭据生成 manifest：name=去 pack- 前缀的 packId，plugins 逐条由 receipt 填充。 */
export function buildManifestFromReceipts(packId: string, receipts: PluginInstallReceipt[]): PackManifest {
  const plugins = receipts.map(receiptToPluginEntry)
  return {
    name: manifestNameFromPackId(packId),
    description: `由 DSH Launcher 从已安装插件导出（${receipts.length} 个插件）。`,
    version: '1.0.0',
    plugins,
  }
}
