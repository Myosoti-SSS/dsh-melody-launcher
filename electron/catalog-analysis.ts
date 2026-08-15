import type {
  CatalogRepositoryAnalysis,
  RepositoryAnalysis,
  SkillRepositoryAnalysis,
} from '../src/types'
import { isDshRepository } from './dsh-install'

function failureMessage(label: 'Plugin' | 'Skill', reason: unknown): string {
  return `${label} 检测失败：${reason instanceof Error ? reason.message : String(reason)}`
}

export function classifyCatalogRepository(
  fullName: string,
  defaultBranch: string,
  pluginResult: PromiseSettledResult<RepositoryAnalysis>,
  skillResult: PromiseSettledResult<SkillRepositoryAnalysis>,
): CatalogRepositoryAnalysis {
  if (isDshRepository(fullName)) {
    return {
      repository: fullName,
      defaultBranch,
      kind: 'dsh',
      summary: '这是 DeepSeek Harness 官方仓库，将作为 DSH 本体安装。',
      pluginAnalysis: null,
      skillAnalysis: null,
      warnings: [],
    }
  }

  const pluginAnalysis = pluginResult.status === 'fulfilled' ? pluginResult.value : null
  const skillAnalysis = skillResult.status === 'fulfilled' ? skillResult.value : null
  const warnings: string[] = []
  if (pluginResult.status === 'rejected') warnings.push(failureMessage('Plugin', pluginResult.reason))
  if (skillResult.status === 'rejected') warnings.push(failureMessage('Skill', skillResult.reason))

  const isPlugin = pluginAnalysis != null
    && ['ready', 'choice', 'dynamic'].includes(pluginAnalysis.installability)
  const isSkill = skillAnalysis != null
    && ['ready', 'choice'].includes(skillAnalysis.installability)

  if (!isPlugin && !isSkill && warnings.length > 0) {
    throw new Error(`仓库类型检测未完成：${warnings.join('；')}`)
  }

  const kind = isPlugin && isSkill
    ? 'hybrid'
    : isPlugin
      ? 'plugin'
      : isSkill
        ? 'skill'
        : 'invalid'
  const summary = kind === 'hybrid'
    ? `确认包含 ${pluginAnalysis?.targets.length ?? 0} 个 Plugin 组件和 ${skillAnalysis?.targets.length ?? 0} 个 Skill 组件。`
    : kind === 'plugin'
      ? pluginAnalysis?.summary ?? '确认是 DSH Plugin。'
      : kind === 'skill'
        ? skillAnalysis?.summary ?? '确认是 DSH Skill。'
        : '没有找到符合 DSH 规范的 Plugin 或 Skill 组件。'

  return {
    repository: fullName,
    defaultBranch,
    kind,
    summary,
    pluginAnalysis,
    skillAnalysis,
    warnings,
  }
}
