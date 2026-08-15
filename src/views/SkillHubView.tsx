import {
  BookOpenCheck,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  Download,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ScanSearch,
  Search,
  Star,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLauncherApi } from '../api/client'
import { CatalogPagination } from '../components/CatalogPagination'
import { PageHeading } from '../components/PageHeading'
import { errorText, formatRelativeTime, formatStars } from '../lib/format'
import type {
  InstallProgress,
  InstalledSkill,
  SkillInstallTarget,
  SkillRepositoryAnalysis,
  SkillRepositoryResult,
} from '../types'

/** Skill Hub：检索 GitHub dsh-skill 仓库，检测并安装 DSH Skills。 */

interface BatchScanState {
  phase: 'running' | 'complete' | 'partial'
  total: number
  completed: number
  available: number
  failed: number
}

interface SkillHubViewProps {
  analyses: Record<string, SkillRepositoryAnalysis>
  onAnalysis: (repository: string, analysis: SkillRepositoryAnalysis) => void
  onInstalled: (skill: InstalledSkill) => void
  onError: (message: string) => void
  onOpenRepository: (url: string) => void
}

export function SkillHubView({ analyses, onAnalysis, onInstalled, onError, onOpenRepository }: SkillHubViewProps) {
  const api = useLauncherApi()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'stars' | 'updated'>('stars')
  const [repositories, setRepositories] = useState<SkillRepositoryResult[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([])
  const [targetDialog, setTargetDialog] = useState<{ repo: SkillRepositoryResult; analysis: SkillRepositoryAnalysis } | null>(null)
  const [batchScan, setBatchScan] = useState<BatchScanState | null>(null)
  const batchRunRef = useRef(0)

  const search = useCallback(async (searchQuery = query, searchSort = sort, searchPage = page) => {
    batchRunRef.current += 1
    setBatchScan(null)
    setTargetDialog(null)
    setLoading(true)
    try {
      const result = await api.discoverSkills(searchQuery, searchSort, searchPage)
      setRepositories(result.repositories)
      setTotal(result.totalCount)
      setPage(searchPage)
      setInstalledSkills(result.installedSkills)
    } catch (error) {
      onError(errorText(error))
    } finally {
      setLoading(false)
    }
  }, [api, onError, page, query, sort])

  useEffect(() => { void search('', 'stars', 1) }, [])
  useEffect(() => {
    const unsubscribe = api.onInstallProgress(progress => {
      if (progress.kind === 'skill') setInstallProgress(progress)
    })
    return unsubscribe
  }, [api])
  useEffect(() => () => { batchRunRef.current += 1 }, [])

  const installedNames = useMemo(() => new Set(installedSkills.map(skill => skill.name)), [installedSkills])
  const batchRunning = batchScan?.phase === 'running'

  const changePage = (nextPage: number) => {
    void search(query, sort, nextPage)
  }

  const inspect = async (repo: SkillRepositoryResult) => {
    setChecking(repo.fullName)
    try {
      const analysis = await api.analyzeSkill(repo.fullName, repo.defaultBranch)
      onAnalysis(repo.fullName, analysis)
      if (analysis.installability === 'choice') setTargetDialog({ repo, analysis })
    } catch (error) {
      onError(errorText(error))
    } finally {
      setChecking(null)
    }
  }

  const install = async (repo: SkillRepositoryResult, target: SkillInstallTarget) => {
    setInstalling(repo.fullName)
    setTargetDialog(null)
    setInstallProgress({ repository: repo.fullName, kind: 'skill', phase: 'preparing', percent: 0, message: '正在准备本地 Skill 目录' })
    try {
      const result = await api.installSkill({ repository: repo.fullName, defaultBranch: repo.defaultBranch, targetId: target.id })
      setInstalledSkills(result.installedSkills)
      onInstalled(result.installedSkill)
    } catch (error) {
      onError(errorText(error))
    } finally {
      setInstalling(null)
    }
  }

  const inspectAll = async () => {
    if (repositories.length === 0 || batchRunning) return
    const runId = batchRunRef.current + 1
    batchRunRef.current = runId
    const totalCandidates = repositories.length
    let completed = 0
    let available = 0
    let failed = 0
    let consecutiveFailures = 0
    let stopped = false
    setTargetDialog(null)
    setBatchScan({ phase: 'running', total: totalCandidates, completed, available, failed })

    for (const repo of repositories) {
      if (batchRunRef.current !== runId) return
      setChecking(repo.fullName)
      try {
        const analysis = await api.analyzeSkill(repo.fullName, repo.defaultBranch)
        if (batchRunRef.current !== runId) return
        onAnalysis(repo.fullName, analysis)
        if (analysis.installability !== 'invalid') available += 1
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

  return (
    <div className="page discover-page skill-hub-page">
      <PageHeading
        eyebrow="SKILL HUB"
        title="发现 DSH Skills"
        description={`从 GitHub dsh-skill 主题中浏览 ${total ? total.toLocaleString('zh-CN') : ''} 个公开仓库。只有通过 DSH 格式检查的内容才能安装。`}
      />
      <div className="discovery-controls">
        <form className="search-field large" onSubmit={event => { event.preventDefault(); void search(query, sort, 1) }}>
          <Search size={18} />
          <input value={query} disabled={batchRunning} onChange={event => setQuery(event.target.value)} placeholder="搜索名称、作者或说明" aria-label="搜索 Skills" />
          {query && <button type="button" disabled={batchRunning} onClick={() => { setQuery(''); void search('', sort, 1) }} aria-label="清除搜索"><X size={16} /></button>}
          <button type="submit" className="search-submit" disabled={batchRunning}>搜索</button>
        </form>
        <div className="discovery-actions">
          <div className="segmented-control" aria-label="Skill 排序方式">
            <button type="button" disabled={batchRunning} className={sort === 'stars' ? 'active' : ''} onClick={() => { setSort('stars'); void search(query, 'stars', 1) }}><Star size={15} />热门</button>
            <button type="button" disabled={batchRunning} className={sort === 'updated' ? 'active' : ''} onClick={() => { setSort('updated'); void search(query, 'updated', 1) }}><Clock3 size={15} />最近更新</button>
          </div>
          <button type="button" className="secondary-button catalog-scan-button" disabled={loading || batchRunning || checking !== null || installing !== null || repositories.length === 0} onClick={() => void inspectAll()} title="检测当前页中的全部 Skill 候选">
            {batchRunning ? <LoaderCircle className="spin" size={15} /> : <ScanSearch size={15} />}
            {batchRunning ? `检测 ${batchScan.completed}/${batchScan.total}` : batchScan ? '再次检测当前页' : '检测当前页'}
          </button>
        </div>
      </div>

      {batchScan && (
        <div className={`batch-scan-status ${batchScan.phase}`} role="status" aria-live="polite">
          {batchRunning ? <LoaderCircle className="spin" size={15} /> : batchScan.phase === 'complete' ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <span>{batchRunning
            ? `正在检测当前页 Skill 候选：${batchScan.completed}/${batchScan.total}`
            : batchScan.phase === 'complete'
              ? `检测完成：${batchScan.total} 个候选中有 ${batchScan.available} 个包含有效 Skill${batchScan.failed ? `，${batchScan.failed} 个检测失败` : ''}`
              : `检测已暂停：完成 ${batchScan.completed}/${batchScan.total}，发现 ${batchScan.available} 个有效 Skill 仓库，${batchScan.failed} 个请求失败`}</span>
          <div className="batch-scan-track" aria-hidden="true"><i style={{ width: `${Math.round(batchScan.completed / batchScan.total * 100)}%` }} /></div>
        </div>
      )}

      <div className="catalog-note skill-hub-note"><BookOpenCheck size={16} /><span>检测会核对 <code>SKILL.md</code> 或单文件 Markdown 的 YAML frontmatter：必须包含 kebab-case 的 <code>name</code> 与 <code>description</code>。通过后安装到 <code>DSH_HOME/skills</code>。</span></div>
      <CatalogPagination page={page} total={total} loading={loading} disabled={batchRunning || checking !== null || installing !== null} onPageChange={changePage} />
      <section className="repository-list" aria-busy={loading}>
        <div className="repository-headings" aria-hidden="true"><span>仓库</span><span>语言</span><span>活跃度</span><span /></div>
        {loading ? (
          <div className="list-loading"><LoaderCircle className="spin" size={21} />正在读取 GitHub Skill 目录</div>
        ) : repositories.length === 0 ? (
          <div className="list-loading"><Search size={21} />没有找到匹配的仓库</div>
        ) : repositories.map(repo => {
          const analysis = analyses[repo.fullName]
          const target = analysis?.targets.length === 1 ? analysis.targets[0] : undefined
          const installedTargetCount = analysis?.targets.filter(item => installedNames.has(item.name)).length ?? 0
          const installed = installedTargetCount > 0
          const progress = installing === repo.fullName && installProgress?.repository === repo.fullName ? installProgress : null
          const indeterminate = progress?.indeterminate === true && progress.phase !== 'error'
          const isChecking = checking === repo.fullName
          const actionLabel = !analysis
            ? '检测'
            : analysis.installability === 'choice'
              ? '选择 Skill'
              : analysis.installability === 'ready'
                ? installed ? '更新' : '安装'
                : '非 Skill'
          const actionDisabled = installing !== null || checking !== null || Boolean(analysis && analysis.installability === 'invalid')
          const runAction = () => {
            if (!analysis) return void inspect(repo)
            if (analysis.installability === 'choice') return setTargetDialog({ repo, analysis })
            if (target) void install(repo, target)
          }
          return (
            <article className="repository-row skill-row" key={repo.id}>
              <div className="repo-main">
                <div className="repo-icon skill-icon"><BookOpenCheck size={18} /></div>
                <div>
                  <div className="repo-title-line">
                    <button type="button" className="repo-title" onClick={() => onOpenRepository(repo.url)}><span>{repo.owner}/</span><strong>{repo.name}</strong><ExternalLink size={13} /></button>
                    {analysis && <span className={`repository-analysis-badge ${analysis.installability}`}>{analysis.installability === 'ready' ? 'Skill' : analysis.installability === 'choice' ? `${analysis.targets.length} Skills` : '非 Skill'}</span>}
                  </div>
                  <p>{repo.description}</p>
                  {analysis && <div className={`repository-analysis-note ${analysis.installability}`}>
                    {analysis.summary}
                    {target && <span>{target.format === 'bundle' ? '目录 Skill' : '单文件 Skill'} · {target.name}{target.modelInvocable ? '' : ' · 不对模型开放'}</span>}
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
                    <div className="progress-track" role="progressbar" aria-label={progress.message} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : progress.percent} aria-valuetext={indeterminate ? '正在进行' : undefined}><span style={indeterminate ? undefined : { width: `${progress.percent}%` }} /></div>
                  </div>
                ) : installed ? (
                  <div className="installed-actions">
                    <span className="installed-label"><Check size={16} />{analysis && analysis.targets.length > 1 ? `已安装 ${installedTargetCount}/${analysis.targets.length}` : '已安装'}</span>
                    <button type="button" className="install-button update-button" disabled={actionDisabled} onClick={runAction} title={`更新 ${target?.name ?? repo.name}`}><RefreshCw size={15} />更新</button>
                  </div>
                ) : (
                  <button type="button" className="install-button" disabled={actionDisabled} onClick={runAction}>
                    {isChecking || installing === repo.fullName ? <LoaderCircle className="spin" size={16} /> : analysis?.installability === 'invalid' ? <CircleAlert size={16} /> : <Download size={16} />}
                    {isChecking ? '检测中' : actionLabel}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </section>
      {targetDialog && (
        <SkillTargetDialog
          repo={targetDialog.repo}
          analysis={targetDialog.analysis}
          installedNames={installedNames}
          busy={installing !== null}
          onClose={() => setTargetDialog(null)}
          onInstall={target => void install(targetDialog.repo, target)}
        />
      )}
    </div>
  )
}

function SkillTargetDialog({ repo, analysis, installedNames, busy, onClose, onInstall }: {
  repo: SkillRepositoryResult
  analysis: SkillRepositoryAnalysis
  installedNames: Set<string>
  busy: boolean
  onClose: () => void
  onInstall: (target: SkillInstallTarget) => void
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !busy) onClose() }}>
      <section className="modal plugin-target-dialog skill-target-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-target-title">
        <header>
          <div><BookOpenCheck size={18} /><h2 id="skill-target-title">选择要安装的 Skill</h2></div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭"><X size={17} /></button>
        </header>
        <div className="modal-content">
          <p className="target-dialog-summary">{repo.fullName} 包含多个通过 DSH 格式检查的 Skills。安装会覆盖同名本地 Skill。</p>
          <div className="plugin-target-list">
            {analysis.targets.map(target => (
              <div className="plugin-target-row" key={target.id}>
                <div className="plugin-target-icon"><BookOpenCheck size={17} /></div>
                <div className="plugin-target-copy">
                  <strong>{target.name}</strong>
                  <span>{target.description}</span>
                  <small>{target.format === 'bundle' ? '目录 Skill' : '单文件 Skill'} · {target.sourcePath}{target.modelInvocable ? '' : ' · 不对模型开放'}</small>
                </div>
                <button type="button" className="install-button" disabled={busy} onClick={() => onInstall(target)}>{installedNames.has(target.name) ? <RefreshCw size={15} /> : <Download size={15} />}{installedNames.has(target.name) ? '更新' : '安装'}</button>
              </div>
            ))}
          </div>
        </div>
        <footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button></footer>
      </section>
    </div>
  )
}
