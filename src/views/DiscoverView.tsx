import {
  BookOpenCheck,
  Bot,
  Box,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  Download,
  ExternalLink,
  FolderGit2,
  Layers3,
  LoaderCircle,
  RefreshCw,
  ScanSearch,
  Search,
  SquareTerminal,
  Star,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLauncherApi } from '../api/client'
import { CatalogPagination } from '../components/CatalogPagination'
import { PageHeading } from '../components/PageHeading'
import { AI_INSTALL_ENABLED, EMPTY_DSH_INSTALLATION } from '../constants'
import { errorText, formatBytes, formatRelativeTime, formatStars } from '../lib/format'
import { isInstallProgressActive } from '../lib/install-progress'
import type {
  CatalogRepositoryAnalysis,
  CatalogRepositoryResult,
  DshInstallationStatus,
  InstalledSkill,
  InstallProgress,
  PluginInstallTarget,
  ProfileState,
  RepositoryInstallResult,
  SkillInstallResult,
  SkillInstallTarget,
} from '../types'

interface BatchScanState {
  phase: 'running' | 'complete' | 'partial'
  total: number
  completed: number
  available: number
  failed: number
}

interface InstallingState {
  repository: string
  kind: InstallProgress['kind']
}

interface DiscoverViewProps {
  profile: ProfileState
  analyses: Record<string, CatalogRepositoryAnalysis>
  installProgress: InstallProgress | null
  installedRepositories: Set<string>
  installedSkills: InstalledSkill[]
  onAnalysis: (repository: string, analysis: CatalogRepositoryAnalysis) => void
  onInstallationState: (repositories: string[], skills: InstalledSkill[]) => void
  onInstallStarted: (progress: InstallProgress) => void
  onInstallFinished: (repository: string) => void
  onPluginInstalled: (repository: string, result: RepositoryInstallResult) => void
  onSkillInstalled: (result: SkillInstallResult) => void
  onError: (message: string) => void
  onOpenRepository: (url: string) => void
  /** 启动「AI 尝试」安装（仅非标准形态显示）。 */
  onAiInstall: (repo: CatalogRepositoryResult) => void
  /** 正在跑 AI 任务的仓库，用于行内 spinner。 */
  aiRepository: string | null
  /** 是否有 AI 任务在跑（全局禁用普通安装与再次触发）。 */
  aiActive: boolean
}

function pluginTargets(analysis: CatalogRepositoryAnalysis | undefined): PluginInstallTarget[] {
  if (!analysis?.pluginAnalysis) return []
  return ['ready', 'choice'].includes(analysis.pluginAnalysis.installability)
    ? analysis.pluginAnalysis.targets
    : []
}

function skillTargets(analysis: CatalogRepositoryAnalysis | undefined): SkillInstallTarget[] {
  if (!analysis?.skillAnalysis) return []
  return ['ready', 'choice'].includes(analysis.skillAnalysis.installability)
    ? analysis.skillAnalysis.targets
    : []
}

function analysisBadge(analysis: CatalogRepositoryAnalysis): { className: string; label: string } {
  if (analysis.kind === 'hybrid') return { className: 'hybrid', label: 'Plugin + Skill' }
  if (analysis.kind === 'skill') return { className: 'skill', label: 'Skill' }
  if (analysis.kind === 'plugin') {
    return analysis.pluginAnalysis?.installability === 'dynamic'
      ? { className: 'dynamic', label: 'Plugin · 动态' }
      : { className: 'plugin', label: 'Plugin' }
  }
  if (analysis.kind === 'dsh') return { className: 'dsh', label: 'DSH 本体' }
  return { className: 'invalid', label: '无效' }
}

export function DiscoverView({
  profile,
  analyses,
  installProgress,
  installedRepositories,
  installedSkills,
  onAnalysis,
  onInstallationState,
  onInstallStarted,
  onInstallFinished,
  onPluginInstalled,
  onSkillInstalled,
  onError,
  onOpenRepository,
  onAiInstall,
  aiRepository,
  aiActive,
}: DiscoverViewProps) {
  const api = useLauncherApi()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'stars' | 'updated'>('stars')
  const [repositories, setRepositories] = useState<CatalogRepositoryResult[]>([])
  const [topicTotals, setTopicTotals] = useState({ plugin: 0, skill: 0 })
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<InstallingState | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [batchScan, setBatchScan] = useState<BatchScanState | null>(null)
  const [dshInstallation, setDshInstallation] = useState<DshInstallationStatus>(EMPTY_DSH_INSTALLATION)
  const [targetDialog, setTargetDialog] = useState<{
    repo: CatalogRepositoryResult
    analysis: CatalogRepositoryAnalysis
  } | null>(null)
  const batchRunRef = useRef(0)

  const search = useCallback(async (searchQuery = query, searchSort = sort, searchPage = page) => {
    batchRunRef.current += 1
    setBatchScan(null)
    setTargetDialog(null)
    setLoading(true)
    try {
      const result = await api.discoverCatalog(searchQuery, searchSort, searchPage)
      setRepositories(result.repositories)
      setTopicTotals(result.topicTotals)
      setPage(result.page)
      setPageCount(result.pageCount)
      setWarnings(result.warnings)
      setDshInstallation(result.dshInstallation)
      onInstallationState(result.installedRepositories, result.installedSkills)
    } catch (error) {
      onError(errorText(error))
    } finally {
      setLoading(false)
    }
  }, [api, onError, onInstallationState, page, query, sort])

  useEffect(() => { void search('', 'stars', 1) }, [])
  useEffect(() => () => { batchRunRef.current += 1 }, [])

  const installedRepos = useMemo(() => {
    const result = new Set(installedRepositories)
    for (const plugin of profile.plugins) {
      if (plugin.repositoryFullName) result.add(plugin.repositoryFullName.toLowerCase())
    }
    return result
  }, [installedRepositories, profile.plugins])
  const installedSkillNames = useMemo(
    () => new Set(installedSkills.map(skill => skill.name)),
    [installedSkills],
  )
  const batchRunning = batchScan?.phase === 'running'
  const restoredInstalling: InstallingState | null = isInstallProgressActive(installProgress)
    ? { repository: installProgress.repository, kind: installProgress.kind }
    : null
  const activeInstalling = installing ?? restoredInstalling

  const inspect = async (repo: CatalogRepositoryResult) => {
    if (repo.kind === 'dsh') return
    setChecking(repo.fullName)
    try {
      const analysis = await api.analyzeCatalogRepository(repo.fullName, repo.defaultBranch)
      onAnalysis(repo.fullName, analysis)
      if (analysis.kind === 'hybrid'
        || pluginTargets(analysis).length + skillTargets(analysis).length > 1) {
        setTargetDialog({ repo, analysis })
      }
    } catch (error) {
      onError(errorText(error))
    } finally {
      setChecking(null)
    }
  }

  const inspectAll = async () => {
    const candidates = repositories.filter(repo => repo.kind !== 'dsh')
    if (candidates.length === 0 || batchRunning) return

    const runId = batchRunRef.current + 1
    batchRunRef.current = runId
    let completed = 0
    let available = 0
    let failed = 0
    let consecutiveFailures = 0
    let stopped = false
    setTargetDialog(null)
    setBatchScan({ phase: 'running', total: candidates.length, completed, available, failed })

    for (const repo of candidates) {
      if (batchRunRef.current !== runId) return
      setChecking(repo.fullName)
      try {
        const analysis = await api.analyzeCatalogRepository(repo.fullName, repo.defaultBranch)
        if (batchRunRef.current !== runId) return
        onAnalysis(repo.fullName, analysis)
        if (analysis.kind !== 'invalid') available += 1
        consecutiveFailures = 0
      } catch (error) {
        if (batchRunRef.current !== runId) return
        failed += 1
        consecutiveFailures += 1
        const message = errorText(error)
        stopped = /403|rate.?limit|请求额度|请求频率/i.test(message) || consecutiveFailures >= 3
      }
      completed += 1
      setBatchScan({ phase: 'running', total: candidates.length, completed, available, failed })
      if (stopped) break
    }

    setChecking(null)
    setBatchScan({
      phase: stopped || completed < candidates.length ? 'partial' : 'complete',
      total: candidates.length,
      completed,
      available,
      failed,
    })
  }

  const installPlugin = async (repo: CatalogRepositoryResult, target?: PluginInstallTarget) => {
    const kind = repo.kind === 'dsh' ? 'dsh' : 'plugin'
    setInstalling({ repository: repo.fullName, kind })
    setTargetDialog(null)
    onInstallStarted({
      repository: repo.fullName,
      kind,
      phase: 'preparing',
      percent: 0,
      message: kind === 'dsh' ? '正在准备本地 DSH' : '正在检查 Plugin 组件',
    })
    try {
      const result = await api.installPlugin(repo.kind === 'dsh'
        ? repo.fullName
        : {
            repository: repo.fullName,
            defaultBranch: repo.defaultBranch,
            targetId: target?.id ?? '',
          })
      setDshInstallation(result.dshInstallation)
      onPluginInstalled(repo.fullName, result)
    } catch (error) {
      onError(errorText(error))
    } finally {
      setInstalling(null)
      onInstallFinished(repo.fullName)
    }
  }

  const installSkill = async (repo: CatalogRepositoryResult, target: SkillInstallTarget) => {
    setInstalling({ repository: repo.fullName, kind: 'skill' })
    setTargetDialog(null)
    onInstallStarted({
      repository: repo.fullName,
      kind: 'skill',
      phase: 'preparing',
      percent: 0,
      message: '正在准备本地 Skill 目录',
    })
    try {
      const result = await api.installSkill({
        repository: repo.fullName,
        defaultBranch: repo.defaultBranch,
        targetId: target.id,
      })
      onSkillInstalled(result)
    } catch (error) {
      onError(errorText(error))
    } finally {
      setInstalling(null)
      onInstallFinished(repo.fullName)
    }
  }

  return (
    <div className="page discover-page catalog-page">
      <PageHeading
        eyebrow="DSH MARKET"
        title="Plugin 与 Skill 资源市场"
        description={`统一浏览 GitHub 中 ${topicTotals.plugin.toLocaleString('zh-CN')} 个 Plugin 候选和 ${topicTotals.skill.toLocaleString('zh-CN')} 个 Skill 候选，安装前会按仓库内容重新识别类型。`}
      />

      <div className="discovery-controls">
        <form className="search-field large" onSubmit={event => { event.preventDefault(); void search(query, sort, 1) }}>
          <Search size={18} />
          <input
            value={query}
            disabled={batchRunning}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索名称、作者或说明"
            aria-label="搜索 Plugin 与 Skill"
          />
          {query && <button type="button" disabled={batchRunning} onClick={() => { setQuery(''); void search('', sort, 1) }} aria-label="清除搜索"><X size={16} /></button>}
          <button type="submit" className="search-submit" disabled={batchRunning}>搜索</button>
        </form>
        <div className="discovery-actions">
          <div className="segmented-control" aria-label="资源排序方式">
            <button type="button" disabled={batchRunning} className={sort === 'stars' ? 'active' : ''} onClick={() => { setSort('stars'); void search(query, 'stars', 1) }}><Star size={15} />热门</button>
            <button type="button" disabled={batchRunning} className={sort === 'updated' ? 'active' : ''} onClick={() => { setSort('updated'); void search(query, 'updated', 1) }}><Clock3 size={15} />最近更新</button>
          </div>
          <button
            type="button"
            className="secondary-button catalog-scan-button"
            disabled={loading || batchRunning || checking !== null || activeInstalling !== null || repositories.every(repo => repo.kind === 'dsh')}
            onClick={() => void inspectAll()}
            title="检测当前页中的全部 Plugin 与 Skill 候选"
          >
            {batchRunning ? <LoaderCircle className="spin" size={15} /> : <ScanSearch size={15} />}
            {batchRunning ? `检测 ${batchScan.completed}/${batchScan.total}` : batchScan ? '再次检测当前页' : '检测当前页'}
          </button>
        </div>
      </div>

      {batchScan && (
        <div className={`batch-scan-status ${batchScan.phase}`} role="status" aria-live="polite">
          {batchRunning ? <LoaderCircle className="spin" size={15} /> : batchScan.phase === 'complete' ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <span>{batchRunning
            ? `正在识别当前页资源：${batchScan.completed}/${batchScan.total}`
            : batchScan.phase === 'complete'
              ? `检测完成：${batchScan.total} 个候选中有 ${batchScan.available} 个 DSH 资源${batchScan.failed ? `，${batchScan.failed} 个检测失败` : ''}`
              : `检测已暂停：完成 ${batchScan.completed}/${batchScan.total}，发现 ${batchScan.available} 个资源，${batchScan.failed} 个请求失败`}</span>
          <div className="batch-scan-track" aria-hidden="true"><i style={{ width: `${Math.round(batchScan.completed / batchScan.total * 100)}%` }} /></div>
        </div>
      )}

      <div className="catalog-note"><CircleAlert size={16} /><span>Topic 只表示仓库自我声明；“检测”会同时验证 Cordis Bundle 与 <code>SKILL.md</code>，再决定安装方式。每个 topic 受 GitHub 前 1,000 条结果限制。</span></div>
      {warnings.map(warning => <div className="catalog-note catalog-warning" key={warning}><CircleAlert size={16} /><span>{warning}</span></div>)}
      <CatalogPagination
        page={page}
        pageCount={pageCount}
        visibleCount={repositories.length}
        loading={loading}
        disabled={batchRunning || checking !== null || activeInstalling !== null}
        onPageChange={nextPage => void search(query, sort, nextPage)}
      />

      <section className="repository-list" aria-busy={loading}>
        <div className="repository-headings" aria-hidden="true"><span>仓库</span><span>语言</span><span>活跃度</span><span /></div>
        {loading ? (
          <div className="list-loading"><LoaderCircle className="spin" size={21} />正在读取 GitHub 资源目录</div>
        ) : repositories.length === 0 ? (
          <div className="list-loading"><Search size={21} />没有找到匹配的仓库</div>
        ) : repositories.map(repo => {
          const analysis = analyses[repo.fullName]
          const plugins = pluginTargets(analysis)
          const skills = skillTargets(analysis)
          const totalTargets = plugins.length + skills.length
          const pluginInstalled = installedRepos.has(repo.fullName.toLowerCase())
          const installedSkillCount = skills.filter(target => installedSkillNames.has(target.name)).length
          const anyInstalled = repo.kind === 'dsh'
            ? dshInstallation.installed
            : pluginInstalled || installedSkillCount > 0
          const progress = activeInstalling?.repository === repo.fullName
            && installProgress?.repository === repo.fullName
            && installProgress.kind === activeInstalling.kind
            ? installProgress
            : null
          const indeterminate = progress?.indeterminate === true && progress.phase !== 'error'
          const isChecking = checking === repo.fullName
          const needsDialog = analysis?.kind === 'hybrid' || totalTargets > 1
          const singlePlugin = plugins.length === 1 && skills.length === 0 ? plugins[0] : undefined
          const singleSkill = skills.length === 1 && plugins.length === 0 ? skills[0] : undefined
          const actionLabel = repo.kind === 'dsh'
            ? dshInstallation.installed ? '更新 DSH' : '安装 DSH'
            : !analysis
              ? anyInstalled ? '检测更新' : '检测'
              : analysis.kind === 'invalid'
                ? '无效资源'
                : totalTargets === 0
                  ? '暂不支持安装'
                  : needsDialog
                    ? '选择组件'
                    : anyInstalled ? '更新' : '安装'
          const actionDisabled = activeInstalling !== null
            || checking !== null
            || aiActive
            || Boolean(analysis && (analysis.kind === 'invalid' || totalTargets === 0))
          // 非标准形态（plugin 的 dynamic/application/invalid，或整体 invalid）——普通安装装不了，转「AI 尝试」。
          const aiTryable = AI_INSTALL_ENABLED
            && !!analysis
            && (analysis.kind === 'invalid'
              || (analysis.kind === 'plugin'
                && analysis.pluginAnalysis?.installability != null
                && !['ready', 'choice'].includes(analysis.pluginAnalysis.installability)))
          const runAction = () => {
            if (repo.kind === 'dsh') return void installPlugin(repo)
            if (!analysis) return void inspect(repo)
            if (needsDialog) return setTargetDialog({ repo, analysis })
            if (singlePlugin) return void installPlugin(repo, singlePlugin)
            if (singleSkill) void installSkill(repo, singleSkill)
          }
          const badge = analysis ? analysisBadge(analysis) : null
          const iconKind = analysis?.kind === 'skill'
            ? 'skill'
            : analysis?.kind === 'hybrid'
              ? 'hybrid'
              : repo.kind === 'dsh' ? 'dsh' : 'plugin'
          const installedLabel = repo.kind === 'dsh'
            ? `${dshInstallation.source === 'system' ? '系统 DSH' : '本地 DSH'} ${dshInstallation.version ?? ''}`
            : analysis?.kind === 'hybrid'
              ? `${pluginInstalled ? 'Plugin 已安装' : 'Plugin 未安装'} · Skills ${installedSkillCount}/${skills.length}`
              : pluginInstalled
                ? 'Plugin 已安装'
                : skills.length > 0 ? `Skills ${installedSkillCount}/${skills.length} 已安装` : '已安装'

          return (
            <article className={`repository-row ${repo.kind === 'dsh' ? 'dsh-core-row' : ''}`} key={repo.id}>
              <div className="repo-main">
                <div className={`repo-icon ${iconKind === 'dsh' ? 'dsh-core-icon' : iconKind === 'skill' ? 'skill-icon' : iconKind === 'hybrid' ? 'hybrid-icon' : ''}`}>
                  {iconKind === 'dsh' ? <Layers3 size={18} /> : iconKind === 'skill' ? <BookOpenCheck size={18} /> : iconKind === 'hybrid' ? <Layers3 size={18} /> : <FolderGit2 size={18} />}
                </div>
                <div>
                  <div className="repo-title-line">
                    <button type="button" className="repo-title" onClick={() => onOpenRepository(repo.url)}><span>{repo.owner}/</span><strong>{repo.name}</strong><ExternalLink size={13} /></button>
                    {repo.kind === 'dsh'
                      ? <span className="dsh-core-badge">DSH 本体</span>
                      : badge
                        ? <span className={`repository-analysis-badge ${badge.className}`}>{badge.label}</span>
                        : <span className="repository-analysis-badge pending">待检测</span>}
                  </div>
                  <p>{repo.description}</p>
                  {analysis && <div className={`repository-analysis-note ${analysis.kind}`}>
                    {analysis.summary}
                    {analysis.warnings.map(warning => <span className="analysis-warning" key={warning}>{warning}</span>)}
                  </div>}
                  <div className="topic-list">
                    {repo.candidateTypes.map(type => <span className="candidate-topic" key={type}>{type === 'plugin' ? 'dsh-plugin 候选' : 'dsh-skill 候选'}</span>)}
                    {repo.topics.filter(topic => !['dsh-plugin', 'dsh-skill'].includes(topic.toLowerCase())).slice(0, 2).map(topic => <span key={topic}>{topic}</span>)}
                  </div>
                </div>
              </div>
              <div className="language-cell"><i className={`language-dot lang-${(repo.language ?? 'other').toLowerCase()}`} />{repo.language ?? '其他'}</div>
              <div className="activity-cell">
                <span><Star size={15} fill="currentColor" />{formatStars(repo.stars)}</span>
                <small>更新于 {formatRelativeTime(repo.updatedAt)}</small>
                {repo.sizeKb != null && repo.sizeKb > 0 && <small>仓库大小 {formatBytes(repo.sizeKb * 1024)}</small>}
              </div>
              <div className="install-cell">
                {progress ? (
                  <div className={`install-progress ${progress.phase === 'error' ? 'error' : ''} ${indeterminate ? 'indeterminate' : ''}`}>
                    <div><LoaderCircle className="spin" size={14} /><span>{progress.message}</span><strong>{indeterminate ? '进行中' : `${progress.percent}%`}</strong></div>
                    {progress.downloadedBytes != null && (
                      <small className="install-progress-size">
                        已下载 {formatBytes(progress.downloadedBytes)}
                        {progress.totalBytes != null && ` / ${formatBytes(progress.totalBytes)}`}
                      </small>
                    )}
                    <div className="progress-track" role="progressbar" aria-label={progress.message} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : progress.percent} aria-valuetext={indeterminate ? '正在进行' : undefined}><span style={indeterminate ? undefined : { width: `${progress.percent}%` }} /></div>
                  </div>
                ) : anyInstalled ? (
                  <div className="installed-actions">
                    <span className="installed-label"><Check size={16} />{installedLabel}</span>
                    <button type="button" className="install-button update-button" disabled={actionDisabled} onClick={runAction} title={`管理 ${repo.name}`}>
                      {isChecking ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{actionLabel}
                    </button>
                  </div>
                ) : (
                  <div className="ai-ready-actions">
                    {aiTryable && (
                      <button
                        type="button"
                        className="secondary-button accent ai-try-button"
                        disabled={aiActive || checking !== null || activeInstalling !== null}
                        onClick={() => onAiInstall(repo)}
                        title="让 DSH 的 AI 研究仓库并尝试安装（实验性，只读自动放行、写操作需批准、可一键还原快照）"
                      >
                        {aiRepository === repo.fullName ? <LoaderCircle className="spin" size={15} /> : <Bot size={15} />}
                        AI 尝试
                      </button>
                    )}
                    <button type="button" className="install-button" disabled={actionDisabled} onClick={runAction}>
                      {isChecking || activeInstalling?.repository === repo.fullName
                        ? <LoaderCircle className="spin" size={16} />
                        : analysis?.kind === 'invalid' || (analysis && totalTargets === 0)
                          ? <CircleAlert size={16} />
                          : <Download size={16} />}
                      {isChecking ? '检测中' : actionLabel}
                    </button>
                  </div>
                )}
              </div>
            </article>
          )
        })}
      </section>

      {targetDialog && (
        <CatalogTargetDialog
          repo={targetDialog.repo}
          analysis={targetDialog.analysis}
          profile={profile}
          installedRepositories={installedRepos}
          installedSkillNames={installedSkillNames}
          busy={activeInstalling !== null}
          onClose={() => setTargetDialog(null)}
          onInstallPlugin={target => void installPlugin(targetDialog.repo, target)}
          onInstallSkill={target => void installSkill(targetDialog.repo, target)}
        />
      )}
    </div>
  )
}

function CatalogTargetDialog({
  repo,
  analysis,
  profile,
  installedRepositories,
  installedSkillNames,
  busy,
  onClose,
  onInstallPlugin,
  onInstallSkill,
}: {
  repo: CatalogRepositoryResult
  analysis: CatalogRepositoryAnalysis
  profile: ProfileState
  installedRepositories: Set<string>
  installedSkillNames: Set<string>
  busy: boolean
  onClose: () => void
  onInstallPlugin: (target: PluginInstallTarget) => void
  onInstallSkill: (target: SkillInstallTarget) => void
}) {
  const plugins = pluginTargets(analysis)
  const skills = skillTargets(analysis)
  const repoInstalled = installedRepositories.has(repo.fullName.toLowerCase())

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !busy) onClose() }}>
      <section className="modal plugin-target-dialog catalog-target-dialog" role="dialog" aria-modal="true" aria-labelledby="catalog-target-title">
        <header>
          <div><Layers3 size={18} /><h2 id="catalog-target-title">选择要安装的组件</h2></div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭"><X size={17} /></button>
        </header>
        <div className="modal-content">
          <p className="target-dialog-summary">{repo.fullName} 的 Plugin 与 Skill 会分别安装；不会自动安装全部内容。</p>

          {(plugins.length > 0 || analysis.pluginAnalysis?.installability === 'dynamic') && (
            <section className="catalog-target-section">
              <h3><Box size={15} />Plugin</h3>
              {analysis.pluginAnalysis?.installability === 'dynamic' && plugins.length === 0
                ? <div className="catalog-target-unavailable"><CircleAlert size={15} />这是动态会话 Plugin，当前不能作为持久 Bundle 安装。</div>
                : <div className="plugin-target-list">
                    {plugins.map(target => {
                      const installed = profile.plugins.some(plugin => plugin.packageName === target.packageName)
                        || (plugins.length === 1 && repoInstalled)
                      return (
                        <div className="plugin-target-row" key={`plugin:${target.id}`}>
                          <div className="plugin-target-icon">{target.platform === 'terminal' ? <SquareTerminal size={17} /> : <Box size={17} />}</div>
                          <div className="plugin-target-copy">
                            <strong>{target.packageName}</strong>
                            <span>{target.source === 'npm' ? `npm ${target.version ?? ''}` : target.source === 'github' ? 'GitHub 仓库根目录' : `仓库子目录：${target.subdirectory}`}</span>
                            <small>{target.profileName} Profile{target.nodeRange ? ` · Node ${target.nodeRange}` : ''}{target.requiresBuild ? ` · 构建脚本：${target.buildScripts.join(', ')}` : ''}</small>
                          </div>
                          <button type="button" className="install-button" disabled={busy} onClick={() => onInstallPlugin(target)}>{installed ? <RefreshCw size={15} /> : <Download size={15} />}{installed ? '更新' : '安装'}</button>
                        </div>
                      )
                    })}
                  </div>}
            </section>
          )}

          {skills.length > 0 && (
            <section className="catalog-target-section">
              <h3><BookOpenCheck size={15} />Skill</h3>
              <div className="plugin-target-list">
                {skills.map(target => {
                  const installed = installedSkillNames.has(target.name)
                  return (
                    <div className="plugin-target-row" key={`skill:${target.id}`}>
                      <div className="plugin-target-icon skill-icon"><BookOpenCheck size={17} /></div>
                      <div className="plugin-target-copy">
                        <strong>{target.name}</strong>
                        <span>{target.description}</span>
                        <small>{target.format === 'bundle' ? '目录 Skill' : '单文件 Skill'} · {target.sourcePath}{target.modelInvocable ? '' : ' · 不对模型开放'}</small>
                      </div>
                      <button type="button" className="install-button" disabled={busy} onClick={() => onInstallSkill(target)}>{installed ? <RefreshCw size={15} /> : <Download size={15} />}{installed ? '更新' : '安装'}</button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </div>
        <footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button></footer>
      </section>
    </div>
  )
}
