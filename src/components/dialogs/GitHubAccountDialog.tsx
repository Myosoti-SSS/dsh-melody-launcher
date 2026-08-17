import { Check, Copy, ExternalLink, Eye, EyeOff, GitFork, LoaderCircle, LogOut, X } from 'lucide-react'
import { useState } from 'react'
import { useLauncherApi } from '../../api/client'
import { errorText } from '../../lib/format'
import type { GitHubAuthStatus, GitHubDeviceAuthorization } from '../../types'

interface GitHubAccountDialogProps {
  status: GitHubAuthStatus
  onStatus: (status: GitHubAuthStatus) => void
  onClose: () => void
  onMessage: (kind: 'success' | 'error', message: string) => void
}

function scopeLabel(scope: string): string {
  const labels: Record<string, string> = {
    repo: '仓库读写',
    workflow: 'Actions 工作流',
    'read:user': '读取账号',
    'user:email': '读取邮箱',
  }
  return labels[scope] ?? scope
}

export function GitHubAccountDialog({ status, onStatus, onClose, onMessage }: GitHubAccountDialogProps) {
  const api = useLauncherApi()
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [busy, setBusy] = useState<'device' | 'token' | 'logout' | null>(null)
  const [authorization, setAuthorization] = useState<GitHubDeviceAuthorization | null>(null)

  const close = () => {
    if (authorization) void api.cancelGitHubDeviceLogin()
    onClose()
  }

  const loginWithToken = async () => {
    setBusy('token')
    try {
      const next = await api.loginGitHubWithToken(token)
      onStatus(next)
      setToken('')
      onMessage('success', `已登录 GitHub：${next.login}`)
    } catch (error) {
      onMessage('error', errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const beginDeviceLogin = async () => {
    setBusy('device')
    try {
      const nextAuthorization = await api.beginGitHubDeviceLogin()
      setAuthorization(nextAuthorization)
      const next = await api.completeGitHubDeviceLogin()
      setAuthorization(null)
      onStatus(next)
      onMessage('success', `已登录 GitHub：${next.login}`)
    } catch (error) {
      setAuthorization(null)
      onMessage('error', errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const logout = async () => {
    setBusy('logout')
    try {
      onStatus(await api.logoutGitHub())
      onMessage('success', 'GitHub 账号已退出。')
    } catch (error) {
      onMessage('error', errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const copyCode = async () => {
    if (!authorization) return
    await navigator.clipboard.writeText(authorization.userCode)
    onMessage('success', '登录码已复制。')
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) close() }}>
      <section className="modal github-account-dialog" role="dialog" aria-modal="true" aria-labelledby="github-account-title">
        <header>
          <div><GitFork size={20} /><h2 id="github-account-title">GitHub 账号</h2></div>
          <button type="button" className="icon-button" onClick={close} aria-label="关闭 GitHub 账号"><X size={18} /></button>
        </header>

        <div className="modal-content">
          {status.authenticated ? (
            <>
              <div className="github-profile-summary">
                <span><GitFork size={24} /></span>
                <div>
                  <small>当前账号</small>
                  <strong>{status.name || status.login}</strong>
                  <span>@{status.login} · {status.method === 'oauth' ? '浏览器授权' : '访问令牌'}</span>
                </div>
                <Check size={20} />
              </div>

              <div className="github-account-section">
                <div className="github-account-heading"><strong>授权范围</strong><span>{status.scopes.length || 'Fine-grained'}</span></div>
                <div className="github-scope-list">
                  {status.scopes.length > 0
                    ? status.scopes.map(scope => <span key={scope}>{scopeLabel(scope)}</span>)
                    : <span>由令牌自身权限控制</span>}
                </div>
              </div>

              {status.rateLimit && (
                <div className="github-rate-row">
                  <span>GitHub API 额度</span>
                  <strong>{status.rateLimit.remaining.toLocaleString('zh-CN')} / {status.rateLimit.limit.toLocaleString('zh-CN')}</strong>
                </div>
              )}
            </>
          ) : authorization ? (
            <div className="github-device-state">
              <LoaderCircle className="spin" size={25} />
              <span>等待 GitHub 确认</span>
              <button type="button" onClick={() => void copyCode()} title="复制登录码">
                <code>{authorization.userCode}</code><Copy size={15} />
              </button>
              <small>浏览器已打开 GitHub 授权页</small>
            </div>
          ) : (
            <>
              {status.oauthAvailable && (
                <button type="button" className="github-browser-login" onClick={() => void beginDeviceLogin()} disabled={busy !== null}>
                  {busy === 'device' ? <LoaderCircle className="spin" size={18} /> : <GitFork size={18} />}
                  <span><strong>使用浏览器登录</strong><small>授权仓库与 Release 管理所需权限</small></span>
                  <ExternalLink size={15} />
                </button>
              )}

              <div className={`form-section ${status.oauthAvailable ? 'divided' : ''}`}>
                <h3>使用访问令牌</h3>
                <p>令牌只在本机加密保存，并用于启动器发往 GitHub 的请求。</p>
              </div>
              <label className="credential-field github-token-field">
                <span>Personal access token</span>
                <div className="secret-input">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={token}
                    onChange={event => setToken(event.target.value)}
                    placeholder="github_pat_..."
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button type="button" onClick={() => setShowToken(value => !value)} aria-label={showToken ? '隐藏令牌' : '显示令牌'}>
                    {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
              <button
                type="button"
                className="secondary-button github-token-help"
                onClick={() => void api.openExternal('https://github.com/settings/tokens?type=beta')}
              >
                <ExternalLink size={15} />创建 Fine-grained token
              </button>
            </>
          )}
        </div>

        <footer>
          {status.authenticated ? (
            <button type="button" className="danger-button github-logout" onClick={() => void logout()} disabled={busy !== null}>
              {busy === 'logout' ? <LoaderCircle className="spin" size={16} /> : <LogOut size={16} />}退出账号
            </button>
          ) : authorization ? (
            <button type="button" className="secondary-button" onClick={close}>取消登录</button>
          ) : (
            <>
              <button type="button" className="secondary-button" onClick={close}>取消</button>
              <button type="button" className="primary-command" onClick={() => void loginWithToken()} disabled={!token.trim() || busy !== null}>
                {busy === 'token' ? <LoaderCircle className="spin" size={16} /> : <GitFork size={16} />}登录 GitHub
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}
