import { ExternalLink, GitFork, GitPullRequest, LoaderCircle, LogIn, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLauncherApi } from '../api/client'
import { PageHeading } from '../components/PageHeading'
import { errorText, formatRelativeTime } from '../lib/format'
import type { GitHubAuthStatus, GitHubPullRequestSummary } from '../types'

interface GitHubViewProps {
  authStatus: GitHubAuthStatus
  onLogin: () => void
  onOpen: (url: string) => void
  onError: (message: string) => void
}

export function GitHubView({ authStatus, onLogin, onOpen, onError }: GitHubViewProps) {
  const api = useLauncherApi()
  const [pullRequests, setPullRequests] = useState<GitHubPullRequestSummary[]>([])
  const [loading, setLoading] = useState(false)
  // 是否已拿到过数据：聚焦触发的重拉走静默路径，不把列表闪回 loading 态。
  const hasDataRef = useRef(false)

  const load = useCallback(async () => {
    if (!authStatus.authenticated) {
      hasDataRef.current = false
      setPullRequests([])
      return
    }
    const showSpinner = !hasDataRef.current
    if (showSpinner) setLoading(true)
    try {
      setPullRequests(await api.listGitHubPullRequests())
      hasDataRef.current = true
    } catch (error) {
      onError(errorText(error))
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [api, authStatus.authenticated, onError])

  useEffect(() => { void load() }, [load])

  return (
    <div className="page github-page">
      <PageHeading
        eyebrow="GITHUB"
        title="GitHub 项目"
        description="查看当前账号最近提交到 DSH Melody Launcher 的共享检测与项目变更。"
      />

      {!authStatus.authenticated ? (
        <section className="github-empty-state">
          <GitFork size={28} />
          <h2>登录 GitHub 后查看提交</h2>
          <p>登录后可以查看共享检测 PR，并在资源市场给仓库点星。</p>
          <button type="button" className="primary-command" onClick={onLogin}><LogIn size={17} />登录 GitHub</button>
        </section>
      ) : (
        <>
          <section className="github-project-summary">
            <div className="github-project-account">
              {authStatus.avatarUrl ? <img src={authStatus.avatarUrl} alt="" /> : <GitFork size={20} />}
              <div><strong>{authStatus.login}</strong><span>已登录 · {authStatus.scopes.includes('repo') ? '具备仓库权限' : '需要 repo 权限才能提交 PR'}</span></div>
            </div>
            <div className="github-project-actions">
              <button type="button" className="secondary-button" onClick={() => onOpen('https://github.com/rirko/dsh-melody-launcher')}><ExternalLink size={15} />打开仓库</button>
              <button type="button" className="icon-button" title="刷新最近提交" aria-label="刷新最近提交" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={17} /></button>
            </div>
          </section>
          <section className="github-pr-list">
            <header><div><GitPullRequest size={18} /><h2>最近提交</h2></div><span>{pullRequests.length} 条</span></header>
            {loading ? <div className="list-loading"><LoaderCircle className="spin" size={20} />正在读取 GitHub</div> : pullRequests.length === 0 ? (
              <div className="github-empty-list"><span>还没有找到基于 Melody Launcher 的提交。</span></div>
            ) : pullRequests.map(pull => (
              <button type="button" className="github-pr-row" key={pull.number} onClick={() => onOpen(pull.url)}>
                <span className={`github-pr-state ${pull.state}`}><GitPullRequest size={17} /></span>
                <span className="github-pr-main"><strong>#{pull.number} {pull.title}</strong><small>{pull.headBranch || '分支'} → {pull.baseBranch || 'main'} · 更新于 {formatRelativeTime(pull.updatedAt)}</small></span>
                <span className="github-pr-label">{pull.state === 'open' ? '开放中' : pull.mergedAt ? '已合并' : '已关闭'}</span>
                <ExternalLink size={15} />
              </button>
            ))}
          </section>
        </>
      )}
    </div>
  )
}
