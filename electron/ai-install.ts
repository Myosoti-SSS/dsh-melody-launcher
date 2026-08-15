/**
 * 非标准插件的「AI 尝试安装」—— 纯函数层。
 *
 * 功能定位：DiscoverView 对 dynamic / application / invalid 三类非标准仓库
 * 提供「AI 尝试」按钮，由 DSH 的 ACP agent 研究仓库并尝试安装。本模块先承载
 * 可单测的纯函数（提示词、审批决策、composition 渲染、快照/回滚），编排核心
 * （createAiInstaller）与协议客户端（./acp-client）分开维护。
 *
 * 安全约定（用户硬性要求「受限且安全」）：
 *   - 审批：只读且非敏感路径自动放行；写操作 / 下载 / 改 profile / 跑安装命令
 *     一律转 ask，弹窗征求用户批准；敏感路径即使只读也转 ask。
 *   - 沙箱：composition 强制 sandbox-policy mode=workspace-write，bash/fs 被
 *     限制在 session cwd（= settings.dshHome）内。
 *   - 快照：任务前对 profile 的 package.json / pnpm-workspace.yaml 与
 *     skills/ 目录做快照，还原时只写快照清单内文件，relPath 防穿越。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type {
  AiInstallEvent,
  AiInstallPhase,
  AiInstallResult,
  AiInstallStatus,
  AppSettings,
  PluginInstallability,
  PluginInstallTarget,
  RepositoryAnalysis,
} from '../src/types'
import {
  createAcpClient,
  type AcpClient,
  type AcpPermissionRequest,
  type AcpTransport,
} from './acp-client'
import { runCommand } from './command'
import type { NodeRuntime } from './node-runtime'
import { spawnCommand } from './process'

// ---------------------------------------------------------------------------
// 常量：ACP 运行时与超时
// ---------------------------------------------------------------------------

/** ACP 独立运行时的托管目录名（位于 userData 下，与核心 DSH 运行时隔离）。 */
export const ACP_RUNTIME_DIRNAME = 'acp-runtime'

/** 单个审批请求的等待超时：5 分钟。超时视为拒绝并取消任务。 */
export const AI_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

/** 单个 AI 安装任务的整体上限：30 分钟。 */
export const AI_TASK_TIMEOUT_MS = 30 * 60 * 1000

/**
 * ACP 运行时精确 pin 的包版本。全部经装包冒烟验证可启动（13 插件最小安全
 * composition 完成 initialize/session/new 握手）。npm latest dist-tag 过时
 * （指向 0.0.1-rc.1），绝不可依赖无版本安装。
 */
export const ACP_RUNTIME_PACKAGES: ReadonlyArray<readonly [packageName: string, version: string]> = [
  ['@deepseek-ai/dsh-acp-demo', '0.1.0-rc.6'],
  ['@deepseek-ai/dsh-llm-deepseek', '0.1.0-rc.6'],
  ['@deepseek-ai/dsh-sandbox-local', '0.1.0-rc.6'],
  ['@deepseek-ai/dsh-sandbox-policy', '0.1.0-rc.6'],
  ['@deepseek-ai/dsh-subprocess-local', '0.1.0-rc.6'],
  ['@deepseek-ai/dsh-bash-sandbox', '0.1.0-rc.6'],
  ['@deepseek-ai/dsh-user-approval', '0.1.0-rc.6'],
  ['@deepseek-ai/dsh-token-meter', '0.1.0-rc.6'],
  ['@deepseek-ai/dsh-compaction-basic', '0.1.0-rc.6'],
  ['@deepseek-ai/dsh-fs-sandbox', '0.1.0-rc.6'],
  ['@deepseek-ai/dsh-fs-observation-policy', '0.1.0-rc.6'],
  ['@deepseek-ai/dsh-tool-fs', '0.1.0-rc.6'],
  ['@deepseek-ai/dsh-tool-todo', '0.1.0-rc.6'],
]

// ---------------------------------------------------------------------------
// 审批决策
// ---------------------------------------------------------------------------

/**
 * 敏感路径匹配：凭据 / 密钥 / token 相关文件名。命中即强制 ask（即使只读）。
 * 边界字符放宽到空白与分隔符，避免 `ls .env`、`cat ~/.ssh/id_rsa` 漏网；
 * 宁可误报（多一次弹窗）不可漏报。
 */
const SENSITIVE_PATH_PATTERN =
  /(\.credentials\.ya?ml|(^|[\\/._\s:"'-])\.env([\\/._\s:"'-]|$)|(^|[\\/._\s:"'-])id_(rsa|ed25519|dsa|ecdsa)|\.(pem|key|pfx|gpg)([\\/._\s:"'-]|$)|(^|[\\/._\s:"'-])(token|secret)s?([\\/._\s:"'-]|$)|api[_-]?key|\.credentials$)/i

/** 判断一条权限请求是否涉及敏感路径（扫描工具名与 rawInput 序列化串）。 */
export function isSensitivePath(request: Pick<AcpPermissionRequest, 'toolTitle' | 'rawInput'>): boolean {
  const pieces: string[] = [request.toolTitle]
  if (request.rawInput !== undefined) {
    pieces.push(JSON.stringify(request.rawInput))
  }
  return pieces.some(piece => SENSITIVE_PATH_PATTERN.test(piece))
}

/** 只读 bash 命令白名单（首个 token）。git 子命令单独白名单。 */
const READ_ONLY_BASH_COMMANDS = new Set([
  'ls', 'pwd', 'find', 'cat', 'head', 'tail', 'grep', 'wc', 'stat', 'file',
  'echo', 'tree', 'du', 'which', 'realpath', 'basename', 'dirname', 'printf',
  'git',
])

/** 只读 git 子命令白名单（对齐计划：status/log/diff/show/branch/remote/…）。 */
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'show', 'branch', 'remote', 'ls-files', 'rev-parse',
  'tag', 'help', 'version',
])

/** 写语义工具词：命中直接判为副作用。 */
const WRITE_WORD_PATTERN =
  /(write|edit|create|delete|remove|move|mkdir|rm|append|copy|rename|patch|apply|upload|touch|unlink)/i

/** 读语义工具词。 */
const READ_WORD_PATTERN = /(read|list|search|grep|glob|info|stat|cat|find|get|view|show|lookup)/i

/** 从 rawInput 提取 bash 命令字符串；取不到返回 null。 */
function stringifyCommand(rawInput: unknown): string | null {
  if (typeof rawInput === 'string') return rawInput
  if (rawInput && typeof rawInput === 'object') {
    const record = rawInput as Record<string, unknown>
    if (typeof record.command === 'string') return record.command
    if (typeof record.command_line === 'string') return record.command_line
    if (typeof record.script === 'string') return record.script
    if (typeof record.value === 'string') return record.value
  }
  return null
}

function isReadOnlyGit(stage: string): boolean {
  const match = /^git\s+([^\s-][^\s]*)/.exec(stage)
  if (!match) return true // 裸 git（帮助类），无副作用
  return READ_ONLY_GIT_SUBCOMMANDS.has(match[1].toLowerCase())
}

/**
 * 判定 bash 命令是否只读：无复合操作符（分号 / 逻辑 / 重定向 / 命令替换 / 换行），
 * 且每个管道段的首个命令都在白名单内。管道只出现在只读命令之间时放行，
 * 这是「受限且安全」与「少打扰」的折中。
 */
function isReadOnlyBashCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return false
  // 复合操作符一律视为有副作用（保守：宁多问一次）。注意单管道 | 不在其中，
  // 由下文 split('|') 拆成只读管道段放行；||（逻辑或）才判复合。
  if (/[;>]|\&\&|\|\||`|\$\s*\(|\n|</.test(trimmed)) return false
  const stages = trimmed.split('|').map(segment => segment.trim()).filter(Boolean)
  if (!stages.length) return false
  return stages.every(stage => {
    const head = /^\S+/.exec(stage)?.[0]?.toLowerCase() ?? ''
    if (head === 'git') return isReadOnlyGit(stage)
    return READ_ONLY_BASH_COMMANDS.has(head)
  })
}

function isReadOnlyToolName(name: string): boolean {
  if (WRITE_WORD_PATTERN.test(name)) return false
  return READ_WORD_PATTERN.test(name)
}

/**
 * 判定一条权限请求是否「只读」。
 * - bash 工具：解析 rawInput 命令串（见 isReadOnlyBashCommand）。
 * - 其他工具：按工具名分类，写语义 → false，读语义 → true，未知 → false。
 */
export function isReadOnlyPermission(request: AcpPermissionRequest): boolean {
  const kind = request.toolKind ?? ''
  if (kind.toLowerCase().includes('bash')) {
    const command = stringifyCommand(request.rawInput)
    if (!command) return false
    return isReadOnlyBashCommand(command)
  }
  const name = `${kind} ${request.toolTitle}`.toLowerCase()
  return isReadOnlyToolName(name)
}

export type ApprovalDecision = 'allow' | 'ask'

/**
 * 混合审批决策：
 *   allow —— 只读且非敏感；
 *   ask   —— 一切写/下载/安装动作，以及敏感路径（即使只读）。
 */
export function decideApproval(request: AcpPermissionRequest): ApprovalDecision {
  if (isSensitivePath(request)) return 'ask'
  return isReadOnlyPermission(request) ? 'allow' : 'ask'
}

// ---------------------------------------------------------------------------
// 安装提示词
// ---------------------------------------------------------------------------

export interface AiInstallPromptInput {
  repository: string
  defaultBranch: string
  analysis: RepositoryAnalysis
  profileName: string
  /** 会话工作目录（沙箱根）= settings.dshHome。 */
  workspace: string
  /** 可用的 DSH 命令行前缀（如 `npx --yes @deepseek-ai/dsh`），agent 借它调 plugin add。 */
  dshCliCommand?: string
}

function classificationLabel(installability: PluginInstallability): string {
  switch (installability) {
    case 'ready': return '标准插件（Bundle 就绪）'
    case 'choice': return '多组件插件'
    case 'dynamic': return '会话内动态插件'
    case 'application': return '应用 / 源码工作区'
    case 'invalid': return '无法识别的仓库'
  }
}

function guidanceFor(installability: PluginInstallability): string {
  switch (installability) {
    case 'dynamic':
      return '该仓库被判定为「会话内动态插件」——通常通过 cordis_define / cordis_run 在会话内加载，而非静态 Bundle。请研究仓库：确认它是否仍包含可安装的 DSH Bundle（package.json 含 dsh.bundle.patch）、或包含可安装的 Skill（见 Skill 安装章节），或说明应如何以动态插件方式加载。能装则装并说明；不能装则给出结论与加载方式。'
    case 'application':
      return '该仓库被判定为「应用 / 源码工作区」——整体不是插件。请在仓库内寻找可作为 DSH Bundle 安装的子包或构建产物（package.json 含 dsh.bundle.patch），或按 Skill 安装章节判断它是否包含可安装的 Skill。找到可安装目标则安装；找不到则明确说明为什么无法作为插件安装。'
    case 'invalid':
      return '该仓库未检测到标准插件 Bundle。请先按 Skill 安装章节判断它是否其实是 Agent Skills 仓库（含 SKILL.md 或单文件 Skill）；是则安装为 Skill。否则检查是否存在隐藏目录、子目录或构建产物形式的 Bundle。若确认既无 Bundle 也无 Skill，明确给出结论（不能作为 DSH 插件或 Skill 安装）及依据。'
    default:
      return '该仓库属于可安装的标准形态。请直接确认安装目标并完成安装。'
  }
}

function formatTargets(targets: PluginInstallTarget[]): string {
  return targets
    .map(target => `${target.packageName}${target.subdirectory ? `（子目录 ${target.subdirectory}）` : ''}`)
    .join('、')
}

/**
 * 构建发给 ACP agent 的安装提示词。内嵌硬约束：禁止读/输出凭据文件、
 * 只操作工作区与目标 profile、一切安装动作等审批。输入不含任何密钥。
 */
export function buildInstallPrompt(input: AiInstallPromptInput): string {
  const { repository, defaultBranch, analysis, profileName, workspace, dshCliCommand } = input
  const cliHint = dshCliCommand
    ? `\n如需调用 DSH 命令行完成安装，可执行：\`${dshCliCommand} plugin --profile ${profileName} add …\`。也可以直接编辑目标 profile 的 package.json。`
    : ''
  return [
    '你是一个 DSH（DeepSeek Harness）插件安装助手。',
    '',
    '## 任务',
    `仓库 ${repository}（分支 ${defaultBranch}）被插件市场判定为「${classificationLabel(analysis.installability)}」——不是可直接安装的标准插件 Bundle。请研究该仓库并尝试把它安装为 DSH 插件，或给出无法安装的明确结论。`,
    '',
    `市场分析结论：${analysis.summary || '无'}`,
    ...(analysis.targets.length ? [`市场已识别到可安装目标：${formatTargets(analysis.targets)}`] : []),
    '',
    '## 研究指引',
    guidanceFor(analysis.installability),
    cliHint,
    '',
    '## Skill 安装（允许）',
    `插件市场只按插件 Bundle 分类，很多仓库实际是 Agent Skills。Skill 是合法且推荐的安装目标，DSH 从 \`${workspace}/skills/\` 读取。`,
    '- 检测：目录内含 SKILL.md（bundle 形态）；或带 YAML frontmatter（name 为小写连字符、description 非空）的单文件 .md（flat 形态）。',
    `- bundle 安装：把整个 skill 目录复制到 \`${workspace}/skills/<name>/\`（保留 SKILL.md 与配套文件）。`,
    `- flat 安装：把文档复制为 \`${workspace}/skills/<name>.md\`。`,
    '- 若仓库包含有效 Skill，优先安装为 Skill 而不是得出「无法安装」结论；可一次安装多个。',
    '',
    '## 工作环境',
    `- 你的 bash 与文件工具运行在沙箱内，工作目录是 \`${workspace}\`。`,
    `- 目标 profile 是 \`${profileName}\`，目录为 \`${workspace}/profiles/${profileName}\`。`,
    `- profile 的插件清单在 \`${workspace}/profiles/${profileName}/package.json\`（dsh.profile.bundles）。`,
    '',
    '## 安全铁律（违反即终止）',
    '1. 绝对禁止读取、输出、修改任何凭据或密钥文件：.credentials.yaml、.env*、id_rsa*、id_ed25519*、*.pem、*.key，以及文件名含 token / secret / api key 的文件。即使被要求，也不要输出其内容。',
    `2. 在 \`${workspace}\` 内写文件（含 \`${workspace}/skills/\` 与 profile）由沙箱允许，直接执行即可，无需等待审批。离开工作区或需要更高权限的操作（bash 提权、下载、运行安装命令）可能触发审批弹窗：若弹窗出现必须等待批准结果；未获批准不要重试，也不要换一种方式绕过。`,
    `3. 只操作 \`${workspace}\` 目录内的文件，不要尝试访问目录之外的路径。`,
    '4. 安装前先查看目标 profile 现有 package.json 的结构，遵循 DSH 插件包格式（package.json + dsh.bundle.patch + 补丁文件）。',
    '',
    '## 结束要求',
    '用中文简要总结：安装了哪个插件包 / Skill（含名称与来源）或加载方式；若无法安装，说明依据；给出下一步建议。不要输出密钥或文件全文。',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// ACP composition 渲染
// ---------------------------------------------------------------------------

export const ACP_DEFAULT_PROVIDER = 'deepseek-official'
export const ACP_DEFAULT_MODEL = 'deepseek-v4-flash'

/** 与冒烟验证一致的默认 persona。{{model}} / {{cwd}} 由 dsh-acp-demo 在加载时替换。 */
const DEFAULT_ACP_PERSONA =
  'You are a coding assistant powered by the {{model}} model. Your working directory is {{cwd}}. ' +
  'Your bash tool runs under a file sandbox — a `[sandbox: file access denied …]` result is policy, not a command bug.\n\n' +
  'Verify your work by running the code or tests. Keep answers brief and factual.'

export interface AcpCompositionConfig {
  provider?: string
  model?: string
  persona?: string
  /** 会话持久化根目录（绝对路径），agent 会话状态写入这里。 */
  persistenceRoot: string
  /** bash 工具超时（毫秒），默认 60000。 */
  bashTimeoutMs?: number
}

function indentLines(text: string, prefix: string): string[] {
  return text.split('\n').map(line => prefix + line)
}

/** 输出安全 YAML 标量：安全字符集走裸标量，否则 JSON（合法 YAML 双引号）转义。 */
function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9_./:\\@-]+$/.test(value)) return value
  return JSON.stringify(value)
}

/**
 * 渲染 ACP server 的 cordis.yml。输出为最小安全集：sandbox-policy
 * workspace-write、user-approval policy=ask、llm/sandbox/subprocess/fs 等 13 个
 * 插件（全部在 ACP_RUNTIME_PACKAGES 中显式 pin）。workspaceRoot / cwd 用
 * !!js process.cwd()（DSH 加载器原生支持，冒烟验证通过）解析为 spawn 时的 cwd。
 */
export function renderAcpComposition(config: AcpCompositionConfig): string {
  const provider = config.provider ?? ACP_DEFAULT_PROVIDER
  const model = config.model ?? ACP_DEFAULT_MODEL
  const persona = (config.persona ?? DEFAULT_ACP_PERSONA).trimEnd()
  const bashTimeoutMs = config.bashTimeoutMs ?? 60_000
  return [
    '# AI 自动安装会话的 ACP composition —— 最小安全集（sandbox workspace-write + 单次审批）。',
    '- id: llm-deepseek',
    "  name: '@deepseek-ai/dsh-llm-deepseek'",
    '  config:',
    '    thinking: enabled',
    '    reasoningEffort: max',
    '    models:',
    '      - id: deepseek-v4-flash',
    '      - id: deepseek-v4-pro',
    '',
    '- id: sandbox',
    "  name: '@deepseek-ai/dsh-sandbox-local'",
    '',
    '- id: sandbox-policy',
    "  name: '@deepseek-ai/dsh-sandbox-policy'",
    '  config:',
    '    mode: workspace-write',
    '    workspaceRoot: !!js process.cwd()',
    '',
    '- id: subprocess',
    "  name: '@deepseek-ai/dsh-subprocess-local'",
    '',
    '- id: bash',
    "  name: '@deepseek-ai/dsh-bash-sandbox'",
    '  config:',
    `    timeoutMs: ${bashTimeoutMs}`,
    '',
    '- id: approval',
    "  name: '@deepseek-ai/dsh-user-approval'",
    '  config:',
    '    policy: ask',
    '',
    '- id: acp-agent',
    "  name: '@deepseek-ai/dsh-acp-demo'",
    '  config:',
    `    provider: ${yamlScalar(provider)}`,
    `    model: ${yamlScalar(model)}`,
    `    persistenceRoot: ${yamlScalar(config.persistenceRoot)}`,
    '    persistenceCompression: none',
    '    workspaceContext:',
    '      maxBytes: 65536',
    '    persona: |',
    ...indentLines(persona, '      '),
    '',
    '- id: token-meter',
    "  name: '@deepseek-ai/dsh-token-meter'",
    '',
    '- id: compaction-basic',
    "  name: '@deepseek-ai/dsh-compaction-basic'",
    '  config:',
    '    thresholdRatio: 0.8',
    '    retainRatio: 0.08',
    '    maxTokens: 8192',
    '    compactionRetries: 1',
    '',
    '- id: fs-sandbox',
    "  name: '@deepseek-ai/dsh-fs-sandbox'",
    '  config:',
    '    cwd: !!js process.cwd()',
    '',
    '- id: fs-observation-policy',
    "  name: '@deepseek-ai/dsh-fs-observation-policy'",
    '',
    '- id: tool-fs',
    "  name: '@deepseek-ai/dsh-tool-fs'",
    '',
    '- id: tool-todo',
    "  name: '@deepseek-ai/dsh-tool-todo'",
    '  config:',
    '    allowParallelInProgress: true',
    '',
  ].join('\n')
}

/** 取 ACP server 可执行文件与启动参数。Windows 下 bin 为 .cmd 包装器。 */
export function buildAcpServerCommand(
  acpRuntimeRoot: string,
  configPath: string,
  platform: NodeJS.Platform = process.platform,
): { executable: string; args: string[] } {
  const binName = platform === 'win32' ? 'dsh-acp-demo.cmd' : 'dsh-acp-demo'
  return {
    executable: path.join(acpRuntimeRoot, 'node_modules', '.bin', binName),
    args: ['--config', configPath],
  }
}

// ---------------------------------------------------------------------------
// profile 快照 / 回滚
// ---------------------------------------------------------------------------

/** 快照内单个文件的相对路径与内容。 */
export interface ProfileFileSnapshot {
  relPath: string
  content: string
}

export interface ProfileSnapshot {
  id: string
  profileName: string
  dshHome: string
  createdAt: string
  /** 快照落盘目录（<snapshotRoot>/<id>），用于审计与持久化。 */
  root: string
  files: ProfileFileSnapshot[]
  /** <dshHome>/skills/ 内文件的快照，relPath 相对 skills/（嵌套路径，允许目录）。 */
  skillFiles: ProfileFileSnapshot[]
}

/** 快照只覆盖这些清单文件，不碰 node_modules（体积过大）。 */
const SNAPSHOT_MANIFEST_NAMES = ['package.json', 'pnpm-workspace.yaml']

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** 临时文件 + rename 原子写（对齐 plugin-receipts.ts）。 */
async function atomicWrite(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  const temporaryPath = `${target}.dsh-launcher.tmp`
  await writeFile(temporaryPath, content, 'utf8')
  try {
    await rename(temporaryPath, target)
  } catch {
    await writeFile(target, content, 'utf8')
    await unlink(temporaryPath).catch(() => undefined)
  }
}

/** relPath 只允许单层普通文件名，杜绝 ../ 或绝对路径穿越。 */
function isSafeSnapshotRelPath(relPath: string): boolean {
  if (!relPath || relPath.length === 0) return false
  if (relPath.includes('/') || relPath.includes('\\')) return false
  if (relPath === '.' || relPath === '..') return false
  return true
}

/** skills/ 下的 relPath 允许嵌套目录，但拒绝绝对路径、空段与 .. 穿越。 */
function isSafeNestedSnapshotRelPath(relPath: string): boolean {
  if (!relPath || relPath.length === 0) return false
  if (path.isAbsolute(relPath)) return false
  const segments = relPath.split(/[\\/]+/)
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return false
  return true
}

/** skills/ 快照不收集这些目录（对齐「不快照 node_modules」原则，.git 同理体积不可控）。 */
const SNAPSHOT_SKILL_IGNORE_DIRS = new Set(['.git', 'node_modules'])

function isWithin(base: string, target: string): boolean {
  const relative = path.relative(base, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * 对目标 profile 的清单文件与 <dshHome>/skills/ 做快照，落盘到 snapshotRoot
 * 并在内存保留内容（还原时以内存内容为准）。skills/ 不存在则快照为空。
 */
export async function createProfileSnapshot(
  dshHome: string,
  profileName: string,
  snapshotRoot: string,
): Promise<ProfileSnapshot> {
  const profileDir = path.join(dshHome, 'profiles', profileName)
  const skillsDir = path.join(dshHome, 'skills')
  const id = `${Date.now()}-${profileName}`
  const root = path.join(snapshotRoot, id)
  await mkdir(root, { recursive: true })
  const files: ProfileFileSnapshot[] = []
  for (const name of SNAPSHOT_MANIFEST_NAMES) {
    const content = await readTextIfExists(path.join(profileDir, name))
    if (content === null) continue
    await atomicWrite(path.join(root, name), content)
    files.push({ relPath: name, content })
  }
  const skillFiles: ProfileFileSnapshot[] = []
  if (existsSync(skillsDir)) {
    await collectSkillFiles(skillsDir, skillsDir, root, skillFiles)
  }
  return { id, profileName, dshHome, createdAt: new Date().toISOString(), root, files, skillFiles }
}

/**
 * 递归收集 skills/ 下所有普通文件为快照清单，并落盘到 <root>/skills/<relPath>。
 * 跳过 .git / node_modules（对齐「不快照 node_modules」原则）；符号链接不跟随、不快照。
 */
async function collectSkillFiles(
  base: string,
  currentDir: string,
  root: string,
  out: ProfileFileSnapshot[],
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (SNAPSHOT_SKILL_IGNORE_DIRS.has(entry.name)) continue
    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      await collectSkillFiles(base, fullPath, root, out)
    } else if (entry.isFile()) {
      const relPath = path.relative(base, fullPath)
      const content = await readFile(fullPath, 'utf8')
      await atomicWrite(path.join(root, 'skills', relPath), content)
      out.push({ relPath, content })
    }
  }
}

/**
 * 还原快照：只写快照清单内文件，relPath 必须通过防穿越校验；目标必须位于
 * profile 目录 / skills 目录内。skills/ 额外做「清单外文件删除」以清掉 AI 新建的
 * skill（快照语义 = 还原到任务前状态）。返回还原/写回的文件数。
 */
export async function restoreProfileSnapshot(snapshot: ProfileSnapshot): Promise<{ restored: number }> {
  const profileDir = path.join(snapshot.dshHome, 'profiles', snapshot.profileName)
  let restored = 0
  for (const file of snapshot.files) {
    if (!isSafeSnapshotRelPath(file.relPath)) {
      throw new Error(`拒绝还原越界路径：${file.relPath}`)
    }
    const target = path.join(profileDir, file.relPath)
    if (!isWithin(profileDir, target)) {
      throw new Error(`拒绝还原越界路径：${file.relPath}`)
    }
    await atomicWrite(target, file.content)
    restored += 1
  }
  restored += await restoreSkillSnapshot(snapshot, path.join(snapshot.dshHome, 'skills'))
  return { restored }
}

/**
 * 还原 skills/ 到快照状态：先把当前 skills 里不在快照清单内的文件删掉（清掉 AI
 * 新建的 skill，目录顺带剪枝），再把快照内容原子写回（还原被 AI 改坏/删掉的 skill）。
 * .git / node_modules 快照没收集，删除也跳过，保证「只动快照清单内的路径」。
 */
async function restoreSkillSnapshot(snapshot: ProfileSnapshot, skillsDir: string): Promise<number> {
  const manifest = new Set(snapshot.skillFiles.map(file => file.relPath))
  if (existsSync(skillsDir)) {
    await removeUnmanifledSkillFiles(skillsDir, skillsDir, manifest)
    // 快照为空且移除后目录已空 → 连空目录一起清掉，回到「任务前无 skills/」的状态；
    // 若快照有文件，写回阶段会用 atomicWrite 的 mkdir 重建目录。
    const remaining = await readdir(skillsDir)
    if (remaining.length === 0) await rm(skillsDir, { recursive: true, force: true })
  }
  let restored = 0
  for (const file of snapshot.skillFiles) {
    if (!isSafeNestedSnapshotRelPath(file.relPath)) {
      throw new Error(`拒绝还原越界路径：${file.relPath}`)
    }
    const target = path.join(skillsDir, file.relPath)
    if (!isWithin(skillsDir, target)) {
      throw new Error(`拒绝还原越界路径：${file.relPath}`)
    }
    await atomicWrite(target, file.content)
    restored += 1
  }
  return restored
}

/**
 * 深度遍历删除清单外的文件，并剪除空目录。relPath 由 path.relative 对真实文件生成，
 * 天然位于 skillsDir 内，不存在穿越面；符号链接快照从未收集，这里也不触碰。
 */
async function removeUnmanifledSkillFiles(
  base: string,
  currentDir: string,
  manifest: Set<string>,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (SNAPSHOT_SKILL_IGNORE_DIRS.has(entry.name)) continue
    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      await removeUnmanifledSkillFiles(base, fullPath, manifest)
      const remaining = await readdir(fullPath)
      if (remaining.length === 0) await rm(fullPath, { recursive: true, force: true })
    } else if (entry.isFile()) {
      const relPath = path.relative(base, fullPath)
      if (!manifest.has(relPath)) await rm(fullPath, { force: true })
    }
  }
}

// ---------------------------------------------------------------------------
// ACP 子进程 transport（生产实现：spawn 的 stdio 行缓冲）
// ---------------------------------------------------------------------------

/**
 * 包一层 spawn 出来的 ACP server 子进程为 AcpTransport：
 * stdout 按行读（协议帧），stderr 转发为日志，stdin 写帧。
 */
export function createSpawnAcpTransport(
  child: ChildProcessWithoutNullStreams,
  onStderr: (text: string) => void,
): AcpTransport {
  const lineHandlers: Array<(line: string) => void> = []
  const closeHandlers: Array<(error?: Error) => void> = []
  const reader = createInterface({ input: child.stdout })
  reader.on('line', line => {
    for (const handler of lineHandlers) handler(line)
  })
  child.stderr.on('data', chunk => onStderr(chunk.toString('utf8')))
  const emitClose = (error?: Error) => {
    const handlers = closeHandlers.splice(0)
    for (const handler of handlers) handler(error)
  }
  child.once('error', error => emitClose(error))
  child.once('exit', code => {
    reader.close()
    emitClose(code === 0 ? undefined : new Error(`ACP server 退出（code ${code ?? '未知'}）`))
  })
  return {
    send(line) {
      child.stdin.write(`${line}\n`)
    },
    onLine(handler) {
      lineHandlers.push(handler)
    },
    onClose(handler) {
      closeHandlers.push(handler)
    },
    close() {
      reader.close()
      try {
        child.stdin.end()
      } catch {
        // 流已关闭可忽略
      }
    },
  }
}

// ---------------------------------------------------------------------------
// ACP 运行时安装（精确 pin，模式同 installManagedDsh）
// ---------------------------------------------------------------------------

/** ACP 子进程环境变量白名单：不透传全部变量，仅路径类 + DSH_HOME + 注入的 key。 */
const ACP_ENV_ALLOWLIST = [
  'PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA',
  'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData',
]

function nodeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { FORCE_COLOR: '0' }
  for (const key of ACP_ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

/** ACP server 子进程环境：白名单 + DSH_HOME + DEEPSEEK_API_KEY（唯一注入的密钥，绝不落日志）。 */
export function acpEnvironment(dshHome: string, apiKey: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { DSH_HOME: dshHome, DEEPSEEK_API_KEY: apiKey, FORCE_COLOR: '0' }
  for (const key of ACP_ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

// ---------------------------------------------------------------------------
// 凭据锁：AI 会话期间把 .credentials.yaml 移出工作区，防 agent 读取
// ---------------------------------------------------------------------------
//
// 实测结论（2026-08 真实 E2E + 源码核对）：DSH 的 workspace-write 沙箱对工作区内
// 的文件读写**不走审批闸门**——`tools/pre-execute` 只在「越界升级」时返回 ask，而
// dshHome 就包含 .credentials.yaml。因此仅靠 denylist + 审批无法阻止 agent 读到
// 用户凭据。本锁在取走 key 后把凭据文件整体移出工作区（env 注入的 key 已足够
// LLM 认证，throwaway E2E 已实测 dshHome 无凭据文件也能跑通），会话结束在
// finally 还原，崩溃残留由启动自愈兜底。

export const CREDENTIALS_FILENAME = '.credentials.yaml'
/** 凭据锁落盘目录名（位于 userData 下，工作区之外）。 */
export const CREDENTIALS_LOCK_DIRNAME = 'ai-credentials-lock'

export interface CredentialsLock {
  /** 原文件在 dshHome 内的绝对路径。 */
  original: string
  /** 锁定时文件被移往的绝对路径（工作区外）。 */
  locked: string
}

/** 跨 dshHome 稳定且防路径字符冲突的锁文件标识。 */
function stableId(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

export function credentialsLockTarget(dshHome: string, lockRoot: string): CredentialsLock {
  return {
    original: path.join(dshHome, CREDENTIALS_FILENAME),
    locked: path.join(lockRoot, `${stableId(dshHome)}-credentials.yaml`),
  }
}

/**
 * 把 dshHome/.credentials.yaml 移到工作区外的 lockRoot，让 ACP agent 摸不到。
 * 调用方必须先 readDeepSeekApiKey 取走 key（env 注入）。文件不存在返回 null
 * （无需锁定）。幂等：上次崩溃残留的同名锁文件先清掉，避免 rename 冲突。
 */
export async function lockCredentialsOut(dshHome: string, lockRoot: string): Promise<CredentialsLock | null> {
  const { original, locked } = credentialsLockTarget(dshHome, lockRoot)
  if (!existsSync(original)) return null
  await mkdir(lockRoot, { recursive: true, mode: 0o700 })
  await rm(locked, { force: true }).catch(() => undefined)
  await rename(original, locked)
  return { original, locked }
}

/**
 * 还原凭据锁。若 agent 在锁定期内重建了同名文件，先移除再还原（以原文件为准）。
 * 找不到锁文件说明已还原或从未锁定，幂等返回。
 */
export async function restoreCredentialsLock(lock: CredentialsLock): Promise<void> {
  if (!existsSync(lock.locked)) return
  await rm(lock.original, { force: true }).catch(() => undefined)
  await rename(lock.locked, lock.original)
}

/**
 * 启动自愈：上次会话崩溃（进程被杀、finally 未跑）可能留下锁文件。若 dshHome 的
 * 凭据缺失而锁文件存在，则还原。在 app 启动时调用一次。
 */
export async function healCredentialsLock(dshHome: string, lockRoot: string): Promise<void> {
  const { original, locked } = credentialsLockTarget(dshHome, lockRoot)
  if (existsSync(original)) return
  if (!existsSync(locked)) return
  await rename(locked, original)
}

/**
 * 确保 ACP 运行时已安装到 acpRuntimeRoot（首次 npm install --prefix，精确 pin）。
 * 已安装（存在 .bin/dsh-acp-demo）时直接返回。
 */
export async function prepareAcpRuntime(
  acpRuntimeRoot: string,
  nodeRuntime: NodeRuntime,
  onOutput?: (text: string) => void,
): Promise<void> {
  const bin = buildAcpServerCommand(acpRuntimeRoot, 'cordis.yml').executable
  if (existsSync(bin)) return
  await mkdir(acpRuntimeRoot, { recursive: true })
  await atomicWrite(path.join(acpRuntimeRoot, 'package.json'), '{"name":"dsh-acp-runtime","private":true}\n')
  const specifiers = ACP_RUNTIME_PACKAGES.map(([name, version]) => `${name}@${version}`)
  onOutput?.('首次安装 ACP 运行时（精确 pin 版本，可能需要几分钟）…')
  const result = await runCommand(nodeRuntime.npm, [
    'install',
    '--prefix', acpRuntimeRoot,
    '--save-exact',
    '--no-audit',
    '--no-fund',
    '--progress=false',
    ...specifiers,
  ], {
    cwd: acpRuntimeRoot,
    env: nodeEnvironment(),
    onOutput: text => onOutput?.(text),
  })
  if (result.exitCode !== 0) {
    throw new Error(`ACP 运行时安装失败（exit ${result.exitCode}）：${result.output.slice(-300)}`)
  }
}

// ---------------------------------------------------------------------------
// 编排核心
// ---------------------------------------------------------------------------

const IDLE_STATUS: AiInstallStatus = {
  phase: 'idle',
  repository: null,
  startedAt: null,
  sessionId: null,
  message: '',
}

const AI_INSTALLABLE = new Set<PluginInstallability>(['dynamic', 'application', 'invalid'])

export interface AiInstallerOptions {
  readSettings: () => Promise<AppSettings>
  /** 获取 Node 运行时（npm/npx）。 */
  prepareNodeRuntime: () => Promise<NodeRuntime>
  /** ACP 运行时托管目录。 */
  acpRuntimeRoot: string
  /** 快照落盘目录。 */
  snapshotRoot: string
  /** 审计日志输出。 */
  emitOutput: (level: 'info' | 'error' | 'success', text: string) => void
  /** 推送给渲染层的事件。 */
  emitEvent: (event: AiInstallEvent) => void
  /** DSH 运行时是否在跑（互斥）。 */
  isRuntimeRunning: () => boolean
  /** 普通安装是否在忙（互斥）。 */
  isInstallerBusy: () => boolean
  /** 复用插件分析的 5 分钟缓存，且主进程重算、不信任渲染层传入的 analysis。 */
  analyzePlugin: (repository: string, defaultBranch: string) => Promise<RepositoryAnalysis>
  /** 读取 DeepSeek API Key（仅主进程内部，绝不打日志）。 */
  readApiKey: (dshHome: string) => Promise<string | null>
}

export interface AiInstaller {
  status(): AiInstallStatus
  isBusy(): boolean
  /** 启动一次 AI 安装任务；返回时任务已完整结束（含清理）。 */
  start(input: { repository: string; defaultBranch: string }): Promise<AiInstallResult>
  /** 对挂起的审批请求给出裁决；找不到返回 false。 */
  approve(requestId: string, allow: boolean): Promise<boolean>
  /** 随时取消当前任务。 */
  cancel(): Promise<void>
  /** 一键还原最近一次快照。 */
  rollback(): Promise<{ restored: number; profileName: string }>
  hasSnapshot(): boolean
}

interface ApprovalEntry {
  resolve: (allow: boolean) => void
  timer: NodeJS.Timeout
}

interface ActiveTask {
  settings: AppSettings
  acp: AcpClient | null
  child: ChildProcessWithoutNullStreams | null
  sessionId: string | null
  approvals: Map<string, ApprovalEntry>
  deadline: NodeJS.Timeout | null
  /** 非空表示任务已中止，值为中止原因。 */
  aborted: string | null
  configPath: string | null
  promptActive: boolean
}

let nextApprovalSeq = 0

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value
  return new Error(typeof value === 'string' ? value : fallback)
}

/** 用户设置里的 DSH 命令行前缀（用于提示 agent 调 plugin add）。 */
function dshCliCommandHint(settings: AppSettings): string {
  const executable = settings.launchExecutable
  if (executable === 'npx' || /(^|[\\/])dsh(\.cmd)?$/i.test(executable)) {
    const args = settings.launchArgs
    const specifierIndex = args.indexOf('@deepseek-ai/dsh')
    const prefix = specifierIndex >= 0 ? args.slice(0, specifierIndex + 1) : args
    return [executable, ...prefix].join(' ')
  }
  return executable
}

/** 审批请求参数展示前脱敏（sk-* 密钥、key/token/secret 字段值），并截断。 */
function sanitizeApprovalArgs(rawInput: unknown): string {
  let text: string
  try {
    text = JSON.stringify(rawInput)
  } catch {
    text = String(rawInput)
  }
  text = text.replace(/(sk-[A-Za-z0-9_-]{8,})/g, 'sk-***')
  text = text.replace(/(\"(?:[^\"]*(?:key|token|secret|password)[^\"]*)\"\s*:\s*\")[^\"]*(\")/gi, '$1***$2')
  text = text.replace(/(\b(?:api[_-]?key|token|secret|password)\b[=:])\s*\S+/gi, '$1 ***')
  return text.length > 500 ? `${text.slice(0, 500)}…` : text
}

function approvalReason(request: AcpPermissionRequest): string {
  if (isSensitivePath(request)) return '涉及凭据/密钥文件，需要确认'
  return '写文件或运行安装命令，需要确认'
}

/** 终止当前任务：拒绝挂起审批、发 cancel、关闭连接（挂起的 prompt 随即拒绝）。 */
async function abortTask(current: ActiveTask, reason: string): Promise<void> {
  if (current.aborted) return
  current.aborted = reason
  for (const entry of current.approvals.values()) {
    clearTimeout(entry.timer)
    entry.resolve(false)
  }
  current.approvals.clear()
  if (current.sessionId && current.acp) {
    try {
      await current.acp.cancel(current.sessionId)
    } catch {
      // 连接已关可忽略
    }
  }
  current.acp?.close()
}

async function killChildProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
    await new Promise<void>(resolve => {
      killer.once('error', () => resolve())
      killer.once('exit', () => resolve())
    })
  } else {
    child.kill('SIGTERM')
  }
}

export function createAiInstaller(options: AiInstallerOptions): AiInstaller {
  let currentStatus: AiInstallStatus = IDLE_STATUS
  let task: ActiveTask | null = null
  let snapshot: ProfileSnapshot | null = null

  function setStatus(partial: Partial<AiInstallStatus>): void {
    currentStatus = { ...currentStatus, ...partial }
    options.emitEvent({ kind: 'status', status: currentStatus })
  }

  function log(text: string): void {
    options.emitOutput('info', `[ai] ${text}`)
    options.emitEvent({ kind: 'log', text })
  }

  /** 终态事件：phase 只允许 done/cancelled/error。 */
  function finishTerminal(phase: AiInstallPhase, message: string): void {
    setStatus({ phase, message })
    options.emitEvent({ kind: phase, message } as AiInstallEvent)
  }

  async function handlePermissionRequest(
    current: ActiveTask,
    request: AcpPermissionRequest,
  ): Promise<boolean> {
    const decision = decideApproval(request)
    if (decision === 'allow') {
      options.emitOutput('info', `[ai] 自动放行只读操作：${request.toolTitle}`)
      options.emitEvent({ kind: 'auto-approved', toolName: request.toolTitle, reason: '只读操作，自动放行' })
      return true
    }
    const requestId = request.toolCallId || `approval-${nextApprovalSeq++}`
    options.emitEvent({
      kind: 'approval',
      request: {
        id: requestId,
        toolName: request.toolTitle,
        toolKind: request.toolKind ?? null,
        args: sanitizeApprovalArgs(request.rawInput),
        reason: approvalReason(request),
      },
    })
    options.emitOutput('info', `[ai] 请求批准：${request.toolTitle}`)
    const allowed = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => {
        current.approvals.delete(requestId)
        options.emitOutput('info', `[ai] 审批超时（5 分钟），已拒绝：${request.toolTitle}`)
        resolve(false)
      }, AI_APPROVAL_TIMEOUT_MS)
      current.approvals.set(requestId, { resolve, timer })
    })
    options.emitOutput('info', `[ai] 审批结果：${allowed ? '允许' : '拒绝'} ${request.toolTitle}`)
    return allowed
  }

  async function runTask(ctx: { settings: AppSettings; prompt: string; apiKey: string }): Promise<void> {
    const taskDir = await mkdtemp(path.join(options.acpRuntimeRoot, 'ai-task-'))
    const current: ActiveTask = {
      settings: ctx.settings,
      acp: null,
      child: null,
      sessionId: null,
      approvals: new Map(),
      deadline: null,
      aborted: null,
      configPath: null,
      promptActive: false,
    }
    task = current
    try {
      const configPath = path.join(taskDir, 'cordis.yml')
      await atomicWrite(configPath, renderAcpComposition({
        provider: ACP_DEFAULT_PROVIDER,
        model: ACP_DEFAULT_MODEL,
        persistenceRoot: path.join(taskDir, 'sessions'),
      }))
      current.configPath = configPath

      const { executable, args } = buildAcpServerCommand(options.acpRuntimeRoot, configPath)
      const child = spawnCommand(executable, args, {
        cwd: taskDir,
        env: acpEnvironment(ctx.settings.dshHome, ctx.apiKey),
      })
      current.child = child
      log(`ACP server 已启动（pid ${child.pid}）`)

      const acp = createAcpClient({
        transport: createSpawnAcpTransport(child, text => options.emitOutput('info', `[acp] ${text}`)),
        clientInfo: { name: 'dsh-melody-launcher', version: '0.1.4' },
        onPermissionRequest: request => handlePermissionRequest(current, request),
        onSessionUpdate: update => {
          if (update.text) log(update.text)
        },
        onClose: error => {
          if (error) options.emitOutput('error', `[acp] 连接关闭：${error.message}`)
        },
      })
      current.acp = acp

      await acp.initialize()
      log('ACP initialize 完成。')
      const sessionId = await acp.sessionNew(ctx.settings.dshHome)
      current.sessionId = sessionId
      setStatus({ phase: 'running', sessionId, message: 'AI 正在研究仓库并尝试安装…' })
      options.emitEvent({ kind: 'log', text: `ACP 会话已创建：${sessionId}` })

      current.deadline = setTimeout(() => {
        void abortTask(current, '任务超时（30 分钟），已中止。')
      }, AI_TASK_TIMEOUT_MS)

      current.promptActive = true
      const stopReason = await acp.prompt(sessionId, ctx.prompt)
      current.promptActive = false

      if (current.aborted) {
        finishTerminal(current.aborted.startsWith('任务超时') ? 'error' : 'cancelled', current.aborted)
      } else if (stopReason === 'end_turn') {
        finishTerminal('done', 'AI 已完成研究。请检查改动；不满意可一键还原快照。')
      } else if (stopReason === 'cancelled') {
        finishTerminal('cancelled', 'AI 会话已取消。')
      } else {
        finishTerminal('done', `AI 结束（stopReason=${stopReason}）。请检查改动；不满意可还原快照。`)
      }
    } catch (error) {
      if (current.aborted) {
        finishTerminal(current.aborted.startsWith('任务超时') ? 'error' : 'cancelled', current.aborted)
      } else {
        const message = asError(error, 'AI 任务异常').message
        options.emitOutput('error', `[ai] 任务失败：${message}`)
        finishTerminal('error', message)
      }
    } finally {
      if (current.deadline) clearTimeout(current.deadline)
      for (const entry of current.approvals.values()) {
        clearTimeout(entry.timer)
        entry.resolve(false)
      }
      current.approvals.clear()
      if (current.acp) {
        try {
          current.acp.close()
        } catch {
          // 已关闭可忽略
        }
      }
      if (current.child) await killChildProcessTree(current.child)
      if (current.configPath) {
        try {
          await rm(path.dirname(current.configPath), { recursive: true, force: true })
        } catch {
          // 清理失败可忽略
        }
      }
      if (task === current) task = null
      options.emitOutput('info', '[ai] 任务已结束，进程树已清理。')
    }
  }

  async function start(input: { repository: string; defaultBranch: string }): Promise<AiInstallResult> {
    if (options.isRuntimeRunning()) return { ok: false, message: '请先停止 DSH 运行时，再开始 AI 安装。' }
    if (options.isInstallerBusy()) return { ok: false, message: '普通安装正在进行，请稍后再试。' }
    if (task) return { ok: false, message: '已有一个 AI 安装任务在进行中。' }

    setStatus({
      phase: 'preparing',
      repository: input.repository,
      startedAt: new Date().toISOString(),
      sessionId: null,
      message: '准备中…',
    })

    // 凭据锁目录：userData 下、工作区之外。
    const credentialsLockRoot = path.join(path.dirname(options.acpRuntimeRoot), CREDENTIALS_LOCK_DIRNAME)
    let credentialsLock: CredentialsLock | null = null
    try {
      const settings = await options.readSettings()
      const analysis = await options.analyzePlugin(input.repository, input.defaultBranch)
      if (!AI_INSTALLABLE.has(analysis.installability)) {
        throw new Error(`该仓库是「${analysis.installability}」形态，属于标准插件，请直接使用「安装」。`)
      }
      const apiKey = await options.readApiKey(settings.dshHome)
      if (!apiKey) throw new Error('未配置 DeepSeek API Key，请先在设置中配置。')

      // key 已读入内存并经 env 注入；把凭据文件移出工作区，让 agent 摸不到。
      credentialsLock = await lockCredentialsOut(settings.dshHome, credentialsLockRoot)
      if (credentialsLock) log('已临时移出凭据文件，会话结束后自动还原。')

      const prompt = buildInstallPrompt({
        repository: input.repository,
        defaultBranch: input.defaultBranch,
        analysis,
        profileName: settings.profileName,
        workspace: settings.dshHome,
        dshCliCommand: dshCliCommandHint(settings),
      })

      log('准备 Node 运行时…')
      const nodeRuntime = await options.prepareNodeRuntime()
      log('准备 ACP 运行时（首次安装可能需要几分钟）…')
      await prepareAcpRuntime(options.acpRuntimeRoot, nodeRuntime, text => options.emitOutput('info', `[acp-install] ${text}`))

      snapshot = await createProfileSnapshot(settings.dshHome, settings.profileName, options.snapshotRoot)
      options.emitEvent({ kind: 'snapshot', snapshotId: snapshot.id })
      log(`已对 profile「${settings.profileName}」做快照：${snapshot.id}`)

      await runTask({ settings, prompt, apiKey })
      return { ok: currentStatus.phase === 'done', message: currentStatus.message }
    } catch (error) {
      const message = asError(error, 'AI 安装启动失败').message
      options.emitOutput('error', `[ai] ${message}`)
      setStatus({ phase: 'error', message })
      options.emitEvent({ kind: 'error', message })
      return { ok: false, message }
    } finally {
      if (credentialsLock) {
        try {
          await restoreCredentialsLock(credentialsLock)
          log('凭据文件已还原。')
        } catch (error) {
          // 还原失败必须 loud：用户需要手动处理锁文件。
          options.emitOutput('error', `[ai] 凭据文件还原失败：${asError(error, '未知错误').message}（请手动恢复 ${credentialsLock.locked}）`)
        }
      }
    }
  }

  async function approve(requestId: string, allow: boolean): Promise<boolean> {
    const current = task
    if (!current) return false
    const entry = current.approvals.get(requestId)
    if (!entry) return false
    current.approvals.delete(requestId)
    clearTimeout(entry.timer)
    entry.resolve(allow)
    return true
  }

  async function cancel(): Promise<void> {
    const current = task
    if (!current || current.aborted) return
    log('用户请求取消…')
    await abortTask(current, '用户已取消')
  }

  async function rollback(): Promise<{ restored: number; profileName: string }> {
    if (!snapshot) throw new Error('没有可用快照，无法还原。')
    const result = await restoreProfileSnapshot(snapshot)
    options.emitOutput('info', `[ai] 已还原 profile「${snapshot.profileName}」与 skills：${result.restored} 个文件`)
    options.emitEvent({ kind: 'log', text: `已还原快照 ${snapshot.id}（profile 与 skills，共 ${result.restored} 个文件）` })
    return { restored: result.restored, profileName: snapshot.profileName }
  }

  return {
    status: () => currentStatus,
    isBusy: () => task !== null,
    start,
    approve,
    cancel,
    rollback,
    hasSnapshot: () => snapshot !== null,
  }
}
