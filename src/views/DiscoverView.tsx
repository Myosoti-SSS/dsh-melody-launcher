import {
  Check,
  CircleAlert,
  Clock3,
  Download,
  ExternalLink,
  Github,
  Layers3,
  LoaderCircle,
  RefreshCw,
  Search,
  Star,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLauncherApi } from '../api/client'
import { PageHeading } from '../components/PageHeading'
import { EMPTY_DSH_INSTALLATION } from '../constants'
import { errorText, formatRelativeTime, formatStars } from '../lib/format'
import type {
  DshInstallationStatus,
  InstallProgress,
  ProfileState,
  RepositoryInstallResult,
  RepositoryResult,
} from '../types'

/** 插件发现页：检索 GitHub 上的 dsh-plugin 仓库并安装。 */

interface DiscoverViewProps {
  profile: ProfileState
  onInstalled: (result: RepositoryInstallResult) => void
  onError: (message: string) => void
  onOpenRepository: (url: string) => void
}

export function DiscoverView({ profile, onInstalled, onError, onOpenRepository }: DiscoverViewProps) {
  const api = useLauncherApi()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'stars' | 'updated'>('stars')
  const [repositories, setRepositories] = useState<RepositoryResult[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)
  const [dshInstallation, setDshInstallation] = useState<DshInstallationStatus>(EMPTY_DSH_INSTALLATION)

  const search = useCallback(async (searchQuery = query, searchSort = sort) => {
    setLoading(true)
    try {
      const result = await api.discoverPlugins(searchQuery, searchSort)
      setRepositories(result.repositories)
      setTotal(result.totalCount)
      setDshInstallation(result.dshInstallation)
    } catch (error) {
      onError(errorText(error))
    } finally {
      setLoading(false)
    }
  }, [api, onError, query, sort])

  // 首次进入时先拉一屏热门插件；后续检索由用户触发。
  useEffect(() => { void search('', 'stars') }, [])
  useEffect(() => api.onInstallProgress(setInstallProgress), [api])

  const installedRepos = useMemo(
    () => new Set(profile.plugins.map(plugin => plugin.repositoryFullName?.toLowerCase()).filter(Boolean)),
    [profile.plugins],
  )

  const install = async (repo: RepositoryResult) => {
    setInstalling(repo.fullName)
    setInstallProgress({
      repository: repo.fullName,
      kind: repo.kind,
      phase: 'preparing',
      percent: 0,
      message: repo.kind === 'dsh' ? '正在准备本地 DSH' : '正在准备安装插件',
    })
    try {
      const result = await api.installPlugin(repo.fullName)
      setDshInstallation(result.dshInstallation)
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
        <form className="search-field large" onSubmit={event => { event.preventDefault(); void search() }}>
          <Search size={18} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索名称、作者或说明" aria-label="搜索插件" />
          {query && <button type="button" onClick={() => { setQuery(''); void search('', sort) }} aria-label="清除搜索"><X size={16} /></button>}
          <button type="submit" className="search-submit">搜索</button>
        </form>
        <div className="segmented-control" aria-label="插件排序方式">
          <button type="button" className={sort === 'stars' ? 'active' : ''} onClick={() => { setSort('stars'); void search(query, 'stars') }}><Star size={15} />热门</button>
          <button type="button" className={sort === 'updated' ? 'active' : ''} onClick={() => { setSort('updated'); void search(query, 'updated') }}><Clock3 size={15} />最近更新</button>
        </div>
      </div>

      <div className="catalog-note"><CircleAlert size={16} /><span>GitHub 主题表示仓库自我声明为 DSH 插件；官方 <code>deepseek-ai/deepseek-harness</code> 会作为 DSH 本体安装到启动器的本地运行目录。</span></div>
      <section className="repository-list" aria-busy={loading}>
        <div className="repository-headings" aria-hidden="true"><span>仓库</span><span>语言</span><span>活跃度</span><span /></div>
        {loading ? (
          <div className="list-loading"><LoaderCircle className="spin" size={21} />正在读取 GitHub 目录</div>
        ) : repositories.length === 0 ? (
          <div className="list-loading"><Search size={21} />没有找到匹配的仓库</div>
        ) : repositories.map(repo => {
          const installed = repo.kind === 'dsh' ? dshInstallation.installed : installedRepos.has(repo.fullName.toLowerCase())
          const progress = installing === repo.fullName && installProgress?.repository === repo.fullName ? installProgress : null
          const indeterminate = progress?.indeterminate === true && progress.phase !== 'error'
          return (
            <article className={`repository-row ${repo.kind === 'dsh' ? 'dsh-core-row' : ''}`} key={repo.id}>
              <div className="repo-main">
                <div className={`repo-icon ${repo.kind === 'dsh' ? 'dsh-core-icon' : ''}`}>{repo.kind === 'dsh' ? <Layers3 size={18} /> : <Github size={18} />}</div>
                <div>
                  <div className="repo-title-line">
                    <button type="button" className="repo-title" onClick={() => onOpenRepository(repo.url)}><span>{repo.owner}/</span><strong>{repo.name}</strong><ExternalLink size={13} /></button>
                    {repo.kind === 'dsh' && <span className="dsh-core-badge">DSH 本体</span>}
                  </div>
                  <p>{repo.description}</p>
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
                    <button type="button" className="install-button update-button" disabled={installing !== null} onClick={() => void install(repo)} title={`检查并更新 ${repo.name}`}>
                      <RefreshCw size={15} />更新
                    </button>
                  </div>
                ) : (
                  <button type="button" className="install-button" disabled={installing !== null} onClick={() => void install(repo)}>
                    {installing === repo.fullName ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
                    {repo.kind === 'dsh' ? '安装 DSH' : '安装'}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </section>
    </div>
  )
}
