import {
  Bot,
  Box,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  Download,
  ExternalLink,
  Github,
  Layers3,
  LoaderCircle,
  PackageCheck,
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
import { errorText, formatRelativeTime, formatStars } from '../lib/format'
import type {
  DshInstallationStatus,
  InstallProgress,
  PluginInstallTarget,
  ProfileState,
  RepositoryAnalysis,
  RepositoryInstallResult,
  RepositoryResult,
} from '../types'

/** 插件发现页：检索 GitHub dsh-plugin 仓库，检测组件并安装。 */

interface BatchScanState {
  phase: 'running' | 'complete' | 'partial'
  total: number
  completed: number
  available: number
  failed: number
}

interface DiscoverViewProps {
  profile: ProfileState
  analyses: Record<string, RepositoryAnalysis>
  onAnalysis: (repository: string, analysis: RepositoryAnalysis) => void
  onInstalled: (result: RepositoryInstallResult) => void
  onError: (message: string) => void
  onOpenRepository: (url: string) => void
  /** 启动「AI 尝试」安装（仅非标准形态显示）。 */
  onAiInstall: (repo: RepositoryResult) => void
  /** 正在跑 AI 任务的仓库，用于行内 spinner。 */
  aiRepository: string | null
  /** 是否有 AI 任务在跑（全局禁用普通安装与再次触发）。 */
  aiActive: boolean
}

export function DiscoverView({ profile, analyses, onAnalysis, onInstalled, onError, onOpenRepository, onAiInstall, aiRepository, aiActive }: DiscoverViewProps) {
  const api = useLauncherApi()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'stars' | 'updated'>('stars')
  const [repositories, setRepositories] = useState<RepositoryResult[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [batchScan, setBatchScan] = useState<BatchScanState | null>(null)
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)
  const [dshInstallation, setDshInstallation] = useState<DshInstallationStatus>(EMPTY_DSH_INSTALLATION)
  const [installedRepositories, setInstalledRepositories] = useState<Set<string>>(new Set())
  const [targetDialog, setTargetDialog] = useState<{ repo: RepositoryResult; analysis: RepositoryAnalysis } | null>(null)
  const batchRunRef = useRef(0)

  const search = useCallback(async (searchQuery = query, searchSort = sort, searchPage = page) => {
    batchRunRef.current += 1
    setBatchScan(null)
    setTargetDialog(null)
    setLoading(true)
    try {
      const result = await api.discoverPlugins(searchQuery, searchSort, searchPage)
      setRepositories(result.repositories)
      setTotal(result.totalCount)
      setPage(searchPage)
      setDshInstallation(result.dshInstallation)
      setInstalledRepositories(new Set(result.installedRepositories.map(name => name.toLowerCase())))
    } catch (error) {
      onError(errorText(error))
    } finally {
      setLoading(false)
    }
  }, [api, onError, page, query, sort])

  useEffect(() => { void search('', 'stars', 1) }, [])
  useEffect(() => api.onInstallProgress(setInstallProgress), [api])
  useEffect(() => () => { batchRunRef.current += 1 }, [])

  const installedRepos = useMemo(() => {
    const result = new Set(installedRepositories)
    for (const plugin of profile.plugins) {
      if (plugin.repositoryFullName) result.add(plugin.repositoryFullName.toLowerCase())
    }
    return result
  }, [installedRepositories, profile.plugins])

  const pluginRepositories = useMemo(
    () => repositories.filter(repository => repository.kind === 'plugin'),
    [repositories],
  )
  const batchRunning = batchScan?.phase === 'running'

  const changePage = (nextPage: number) => {
    void search(query, sort, nextPage)
  }

  const inspect = async (repo: RepositoryResult) => {
    setChecking(repo.fullName)
    try {
      const analysis = await api.analyzePlugin(repo.fullName, repo.defaultBranch)
      onAnalysis(repo.fullName, analysis)
      if (analysis.installability === 'choice') setTargetDialog({ repo, analysis })
    } catch (error) {
      onError(errorText(error))
    } finally {
      setChecking(null)
    }
  }

  const inspectAll = async () => {
    if (pluginRepositories.length === 0 || batchRunning) return

    const runId = batchRunRef.current + 1
    batchRunRef.current = runId
    const totalCandidates = pluginRepositories.length
    let completed = 0
    let available = 0
    let failed = 0
    let consecutiveFailures = 0
    let stopped = false
    setTargetDialog(null)
    setBatchScan({ phase: 'running', total: totalCandidates, completed, available, failed })

    for (const repo of pluginRepositories) {
      if (batchRunRef.current !== runId) return
      setChecking(repo.fullName)
      try {
        const analysis = await api.analyzePlugin(repo.fullName, repo.defaultBranch)
        if (batchRunRef.current !== runId) return
        onAnalysis(repo.fullName, analysis)
        if (analysis.installability === 'ready' || analysis.installability === 'choice') available += 1
        consecutiveFailures = 0
      } catch (error) {
        if (batchRunRef.current !== runId) return
        failed += 1
        consecutiveFailures += 1
        const message = errorText(error)
        stopped = /403|rate.?limit|请求额度|请求频率/i.test(message) || consecutiveFailures >= 3
      }

      completed += 1
      setBatchScan({ phase: 'running', total: totalCandidates, completed, available, failed })
      if (stopped) break
    }

    setChecking(null)
    setBatchScan({
      phase: stopped || completed < totalCandidates ? 'partial' : 'complete',
      total: totalCandidates,
      completed,
      available,
      failed,
    })
  }

  const install = async (repo: RepositoryResult, target?: PluginInstallTarget) => {
    setInstalling(repo.fullName)
    setTargetDialog(null)
    setInstallProgress({ repository: repo.fullName, kind: repo.kind, phase: 'preparing', percent: 0, message: repo.kind === 'dsh' ? '正在准备本地 DSH' : '正在检查插件组件' })
    try {
      const result = await api.installPlugin(repo.kind === 'dsh'
        ? repo.fullName
        : {
            repository: repo.fullName,
            defaultBranch: repo.defaultBranch,
            targetId: target?.id ?? '',
          })
      setDshInstallation(result.dshInstallation)
      setInstalledRepositories(current => new Set(current).add(repo.fullName.toLowerCase()))
      onInstalled(result)
    } catch (error) {
      onError(errorText(error))
    } finally {
      setInstalling(null)
    }
  }

  return (
    <div className="page discover-page">
      <PageHeading
        eyebrow="GITHUB CATALOG"
        title="发现 DSH 插件"
        description={`从 GitHub dsh-plugin 主题中浏览 ${total ? total.toLocaleString('zh-CN') : ''} 个公开仓库。安装前请检查仓库说明与来源。`}
      />
      <div className="discovery-controls">
        <form className="search-field large" onSubmit={event => { event.preventDefault(); void search(query, sort, 1) }}>
          <Search size={18} />
          <input value={query} disabled={batchRunning} onChange={event => setQuery(event.target.value)} placeholder="搜索名称、作者或说明" aria-label="搜索插件" />
          {query && <button type="button" disabled={batchRunning} onClick={() => { setQuery(''); void search('', sort, 1) }} aria-label="清除搜索"><X size={16} /></button>}
          <button type="submit" className="search-submit" disabled={batchRunning}>搜索</button>
        </form>
        <div className="discovery-actions">
          <div className="segmented-control" aria-label="插件排序方式">
            <button type="button" disabled={batchRunning} className={sort === 'stars' ? 'active' : ''} onClick={() => { setSort('stars'); void search(query, 'stars', 1) }}><Star size={15} />热门</button>
            <button type="button" disabled={batchRunning} className={sort === 'updated' ? 'active' : ''} onClick={() => { setSort('updated'); void search(query, 'updated', 1) }}><Clock3 size={15} />最近更新</button>
          </div>
          <button
            type="button"
            className="secondary-button catalog-scan-button"
            disabled={loading || batchRunning || checking !== null || installing !== null || pluginRepositories.length === 0}
            onClick={() => void inspectAll()}
            title="检测当前页中的全部第三方插件候选"
          >
            {batchRunning ? <LoaderCircle className="spin" size={15} /> : <ScanSearch size={15} />}
            {batchRunning ? `检测 ${batchScan.completed}/${batchScan.total}` : batchScan ? '再次检测当前页' : '检测当前页'}
          </button>
        </div>
      </div>

      {batchScan && (
        <div className={`batch-scan-status ${batchScan.phase}`} role="status" aria-live="polite">
          {batchRunning ? <LoaderCircle className="spin" size={15} /> : batchScan.phase === 'complete' ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <span>
            {batchRunning
              ? `正在检测当前页插件候选：${batchScan.completed}/${batchScan.total}`
              : batchScan.phase === 'complete'
                ? `检测完成：${batchScan.total} 个候选中有 ${batchScan.available} 个包含可安装组件${batchScan.failed ? `，${batchScan.failed} 个检测失败` : ''}`
                : `检测已暂停：完成 ${batchScan.completed}/${batchScan.total}，发现 ${batchScan.available} 个可安装组件，${batchScan.failed} 个请求失败`}
          </span>
          <div className="batch-scan-track" aria-hidden="true"><i style={{ width: `${Math.round(batchScan.completed / batchScan.total * 100)}%` }} /></div>
        </div>
      )}

      <div className="catalog-note"><CircleAlert size={16} /><span>GitHub 主题表示仓库自我声明为 DSH 插件；官方 <code>deepseek-ai/deepseek-harness</code> 会作为 DSH 本体安装到启动器的本地运行目录。</span></div>
      <CatalogPagination page={page} total={total} loading={loading} disabled={batchRunning || checking !== null || installing !== null} onPageChange={changePage} />
      <section className="repository-list" aria-busy={loading}>
        <div className="repository-headings" aria-hidden="true"><span>仓库</span><span>语言</span><span>活跃度</span><span /></div>
        {loading ? (
          <div className="list-loading"><LoaderCircle className="spin" size={21} />正在读取 GitHub 目录</div>
        ) : repositories.length === 0 ? (
          <div className="list-loading"><Search size={21} />没有找到匹配的仓库</div>
        ) : repositories.map(repo => {
          const installed = repo.kind === 'dsh' ? dshInstallation.installed : installedRepos.has(repo.fullName.toLowerCase())
          const analysis = analyses[repo.fullName]
          const progress = installing === repo.fullName && installProgress?.repository === repo.fullName ? installProgress : null
          const indeterminate = progress?.indeterminate === true && progress.phase !== 'error'
          const isChecking = checking === repo.fullName
          const target = analysis?.targets.length === 1 ? analysis.targets[0] : undefined
          const actionLabel = repo.kind === 'dsh'
            ? installed ? '更新 DSH' : '安装 DSH'
            : !analysis
              ? installed ? '检测更新' : '检测'
              : analysis.installability === 'choice'
                ? '选择组件'
                : analysis.installability === 'ready'
                  ? installed ? '更新' : '安装'
                  : analysis.installability === 'dynamic'
                    ? '动态插件'
                    : analysis.installability === 'application'
                      ? '非插件'
                      : '不可安装'
          const actionDisabled = installing !== null
            || checking !== null
            || aiActive
            || Boolean(analysis && !['ready', 'choice'].includes(analysis.installability))
          const aiTryable = AI_INSTALL_ENABLED
            && analysis
            && !['ready', 'choice'].includes(analysis.installability)
          const runAction = () => {
            if (repo.kind === 'dsh') return void install(repo)
            if (!analysis) return void inspect(repo)
            if (analysis.installability === 'choice') return setTargetDialog({ repo, analysis })
            if (target) void install(repo, target)
          }
          return (
            <article className={`repository-row ${repo.kind === 'dsh' ? 'dsh-core-row' : ''}`} key={repo.id}>
              <div className="repo-main">
                <div className={`repo-icon ${repo.kind === 'dsh' ? 'dsh-core-icon' : ''}`}>{repo.kind === 'dsh' ? <Layers3 size={18} /> : <Github size={18} />}</div>
                <div>
                  <div className="repo-title-line">
                    <button type="button" className="repo-title" onClick={() => onOpenRepository(repo.url)}><span>{repo.owner}/</span><strong>{repo.name}</strong><ExternalLink size={13} /></button>
                    {repo.kind === 'dsh' && <span className="dsh-core-badge">DSH 本体</span>}
                    {analysis && <span className={`repository-analysis-badge ${analysis.installability}`}>{analysis.installability === 'ready' ? 'Bundle' : analysis.installability === 'choice' ? `${analysis.targets.length} 个组件` : analysis.installability === 'dynamic' ? '动态' : analysis.installability === 'application' ? '应用' : '无效'}</span>}
                  </div>
                  <p>{repo.description}</p>
                  {analysis && <div className={`repository-analysis-note ${analysis.installability}`}>
                    {analysis.summary}
                    {target && <span>{target.source === 'npm' ? 'npm' : target.source === 'github' ? 'GitHub' : `子目录 ${target.subdirectory}`} · {target.profileName} Profile{target.requiresBuild ? ' · 需要构建' : ''}</span>}
                  </div>}
                  <div className="topic-list">{repo.topics.slice(0, 3).map(topic => <span key={topic}>{topic}</span>)}</div>
                </div>
              </div>
              <div className="language-cell"><i className={`language-dot lang-${(repo.language ?? 'other').toLowerCase()}`} />{repo.language ?? '其他'}</div>
              <div className="activity-cell"><span><Star size={15} fill="currentColor" />{formatStars(repo.stars)}</span><small>更新于 {formatRelativeTime(repo.updatedAt)}</small></div>
              <div className="install-cell">
                {progress ? (
                  <div className={`install-progress ${progress.phase === 'error' ? 'error' : ''} ${indeterminate ? 'indeterminate' : ''}`}>
                    <div><LoaderCircle className="spin" size={14} /><span>{progress.message}</span><strong>{indeterminate ? '进行中' : `${progress.percent}%`}</strong></div>
                    <div
                      className="progress-track"
                      role="progressbar"
                      aria-label={progress.message}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={indeterminate ? undefined : progress.percent}
                      aria-valuetext={indeterminate ? '正在进行' : undefined}
                    ><span style={indeterminate ? undefined : { width: `${progress.percent}%` }} /></div>
                  </div>
                ) : installed ? (
                  <div className="installed-actions">
                    <span className="installed-label"><Check size={16} />{repo.kind === 'dsh' ? `${dshInstallation.source === 'system' ? '系统 DSH' : '本地 DSH'} ${dshInstallation.version ?? ''}` : '已下载'}</span>
                    <button type="button" className="install-button update-button" disabled={actionDisabled} onClick={runAction} title={`检查并更新 ${repo.name}`}>
                      {isChecking ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{actionLabel}
                    </button>
                  </div>
                ) : (
                  <div className="ai-ready-actions">
                    {aiTryable && (
                      <button
                        type="button"
                        className="secondary-button accent ai-try-button"
                        disabled={aiActive || checking !== null || installing !== null}
                        onClick={() => onAiInstall(repo)}
                        title="让 DSH 的 AI 研究仓库并尝试安装（实验性，只读自动放行、写操作需批准、可一键还原快照）"
                      >
                        {aiRepository === repo.fullName ? <LoaderCircle className="spin" size={15} /> : <Bot size={15} />}
                        AI 尝试
                      </button>
                    )}
                    <button type="button" className="install-button" disabled={actionDisabled} onClick={runAction}>
                      {isChecking || installing === repo.fullName ? <LoaderCircle className="spin" size={16} /> : analysis?.installability === 'application' ? <Box size={16} /> : analysis && !['ready', 'choice'].includes(analysis.installability) ? <CircleAlert size={16} /> : <Download size={16} />}
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
        <PluginTargetDialog
          repo={targetDialog.repo}
          analysis={targetDialog.analysis}
          busy={installing !== null}
          onClose={() => setTargetDialog(null)}
          onInstall={target => void install(targetDialog.repo, target)}
        />
      )}
    </div>
  )
}

function PluginTargetDialog({ repo, analysis, busy, onClose, onInstall }: {
  repo: RepositoryResult
  analysis: RepositoryAnalysis
  busy: boolean
  onClose: () => void
  onInstall: (target: PluginInstallTarget) => void
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !busy) onClose() }}>
      <section className="modal plugin-target-dialog" role="dialog" aria-modal="true" aria-labelledby="plugin-target-title">
        <header>
          <div><PackageCheck size={18} /><h2 id="plugin-target-title">选择插件组件</h2></div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭"><X size={17} /></button>
        </header>
        <div className="modal-content">
          <p className="target-dialog-summary">{repo.fullName} 包含多个可安装组件。每个组件会安装到它适用的 Profile。</p>
          <div className="plugin-target-list">
            {analysis.targets.map(target => (
              <div className="plugin-target-row" key={target.id}>
                <div className="plugin-target-icon">{target.platform === 'terminal' ? <SquareTerminal size={17} /> : <Box size={17} />}</div>
                <div className="plugin-target-copy">
                  <strong>{target.packageName}</strong>
                  <span>{target.source === 'npm' ? `npm ${target.version ?? ''}` : target.source === 'github' ? 'GitHub 仓库根目录' : `仓库子目录：${target.subdirectory}`}</span>
                  <small>{target.profileName} Profile{target.nodeRange ? ` · Node ${target.nodeRange}` : ''}{target.requiresBuild ? ` · 构建脚本：${target.buildScripts.join(', ')}` : ''}</small>
                </div>
                <button type="button" className="install-button" disabled={busy} onClick={() => onInstall(target)}><Download size={15} />安装</button>
              </div>
            ))}
          </div>
        </div>
        <footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button></footer>
      </section>
    </div>
  )
}
