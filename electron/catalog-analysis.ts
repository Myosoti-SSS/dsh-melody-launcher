import type {
  ApplicationRepositoryAnalysis,
  CatalogComponentKind,
  CatalogRepositoryAnalysis,
  RepositoryAnalysis,
  SkillRepositoryAnalysis,
} from '../src/types'
import { isDshRepository } from './dsh-install'

function failureMessage(label: 'Plugin' | 'Skill' | '应用加载项', reason: unknown): string {
  const prefix = label === '应用加载项' ? label : `${label} `
  return `${prefix}检测失败：${reason instanceof Error ? reason.message : String(reason)}`
}

export function classifyCatalogRepository(
  fullName: string,
  defaultBranch: string,
  pluginResult: PromiseSettledResult<RepositoryAnalysis>,
  skillResult: PromiseSettledResult<SkillRepositoryAnalysis>,
  applicationResult: PromiseSettledResult<ApplicationRepositoryAnalysis>,
): CatalogRepositoryAnalysis {
  if (isDshRepository(fullName)) {
    return {
      repository: fullName,
      defaultBranch,
      kind: 'dsh',
      componentKinds: [],
      summary: '这是 DeepSeek Harness 官方仓库，将作为 DSH 本体安装。',
      pluginAnalysis: null,
      skillAnalysis: null,
      applicationAnalysis: null,
      warnings: [],
    }
  }

  const pluginAnalysis = pluginResult.status === 'fulfilled' ? pluginResult.value : null
  const skillAnalysis = skillResult.status === 'fulfilled' ? skillResult.value : null
  const applicationAnalysis = applicationResult.status === 'fulfilled' ? applicationResult.value : null
  const warnings: string[] = []
  if (pluginResult.status === 'rejected') warnings.push(failureMessage('Plugin', pluginResult.reason))
  if (skillResult.status === 'rejected') warnings.push(failureMessage('Skill', skillResult.reason))
  if (applicationResult.status === 'rejected') warnings.push(failureMessage('应用加载项', applicationResult.reason))

  const isPlugin = pluginAnalysis != null
    && ['ready', 'choice', 'dynamic'].includes(pluginAnalysis.installability)
  const isSkill = skillAnalysis != null
    && ['ready', 'choice'].includes(skillAnalysis.installability)
  const isApplication = applicationAnalysis != null
    && ['ready', 'choice', 'unsupported'].includes(applicationAnalysis.installability)

  if (!isPlugin && !isSkill && !isApplication && warnings.length > 0) {
    throw new Error(`仓库类型检测未完成：${warnings.join('；')}`)
  }

  const componentKinds: CatalogComponentKind[] = []
  if (isPlugin) componentKinds.push('plugin')
  if (isSkill) componentKinds.push('skill')
  if (isApplication) componentKinds.push('application')
  const kind = componentKinds.length > 1
    ? 'hybrid'
    : componentKinds[0] ?? 'invalid'
  const summary = kind === 'hybrid'
    ? `确认包含 ${componentKinds.map(component => component === 'plugin'
      ? `${pluginAnalysis?.targets.length ?? 0} 个 Plugin`
      : component === 'skill'
        ? `${skillAnalysis?.targets.length ?? 0} 个 Skill`
        : `${applicationAnalysis?.targets.length ?? 0} 个应用加载项`).join('、')}。`
    : kind === 'plugin'
      ? pluginAnalysis?.summary ?? '确认是 DSH Plugin。'
      : kind === 'skill'
        ? skillAnalysis?.summary ?? '确认是 DSH Skill。'
        : kind === 'application'
          ? applicationAnalysis?.summary ?? '确认是 DSH 应用加载项。'
          : '没有找到符合 DSH 规范的 Plugin、Skill 或应用加载项。'

  return {
    repository: fullName,
    defaultBranch,
    kind,
    componentKinds,
    summary,
    pluginAnalysis,
    skillAnalysis,
    applicationAnalysis,
    warnings,
  }
}
