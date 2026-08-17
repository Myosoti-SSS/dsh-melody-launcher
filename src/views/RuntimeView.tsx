import { CircleCheck, CircleStop, ExternalLink, LoaderCircle, Play, Settings, SquareTerminal, Wrench } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { PageHeading } from '../components/PageHeading'
import type { AppSettings, RuntimeOutput, RuntimeState } from '../types'

/** 运行与日志页：进程状态、启动参数与实时输出。 */

interface RuntimeViewProps {
  runtime: RuntimeState
  settings: AppSettings
  logs: RuntimeOutput[]
  busy: boolean
  onToggleRuntime: () => void
  onOpenHarness: () => void
  onClearLogs: () => void
  onOpenSettings: () => void
  onRepairRuntime: () => void
  aiActive: boolean
}

export function RuntimeView({
  runtime,
  settings,
  logs,
  busy,
  onToggleRuntime,
  onOpenHarness,
  onClearLogs,
  onOpenSettings,
  onRepairRuntime,
  aiActive,
}: RuntimeViewProps) {
  const logEnd = useRef<HTMLDivElement>(null)

  // 新日志到达时保持视图贴在底部。
  useEffect(() => {
    logEnd.current?.scrollIntoView?.({ block: 'nearest' })
  }, [logs])

  return (
    <div className="page runtime-page">
      <PageHeading
        eyebrow="LOCAL RUNTIME"
        title="运行 DeepSeek Harness"
        description="从当前工作目录启动 Web 界面，并在这里查看进程状态与实时输出。"
        actions={<button type="button" className="secondary-button" onClick={onOpenSettings}><Settings size={16} />启动设置</button>}
      />
      <section className={`runtime-band ${runtime.running ? 'running' : ''}`}>
        <div className="runtime-status-icon">{runtime.running ? <CircleCheck size={25} /> : <CircleStop size={25} />}</div>
        <div className="runtime-copy"><span>{runtime.running ? 'DSH 正在运行' : 'DSH 当前已停止'}</span><strong>{runtime.running ? runtime.url ?? '正在等待 Web 地址…' : '准备从本地启动'}</strong></div>
        <div className="runtime-metadata"><span>配置 <strong>{settings.profileName}</strong></span><span>{runtime.pid ? `PID ${runtime.pid}` : '无活动进程'} · 端口 {runtime.port ?? settings.webPort}</span></div>
        {runtime.url && <button type="button" className="secondary-button" onClick={onOpenHarness}>打开工作台<ExternalLink size={15} /></button>}
        {!runtime.running && runtime.lastFailure && (
          <button type="button" className="secondary-button accent runtime-repair-button" onClick={onRepairRuntime} disabled={busy || aiActive} title="调用 DSH Flash 模型分析最近一次启动错误并尝试修复">
            {aiActive ? <LoaderCircle className="spin" size={16} /> : <Wrench size={16} />}
            AI 分析并修复
          </button>
        )}
        <button type="button" className={`primary-command ${runtime.running ? 'stop' : ''}`} onClick={onToggleRuntime} disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={17} /> : runtime.running ? <CircleStop size={17} /> : <Play size={17} fill="currentColor" />}
          {runtime.running ? '停止' : '启动'}
        </button>
      </section>

      <div className="launch-facts">
        <div><span>启动命令</span><code>{settings.launchExecutable} {settings.launchArgs.join(' ')}</code></div>
        <div><span>工作目录</span><code>{settings.workspace}</code></div>
        <div><span>DSH_HOME</span><code>{settings.dshHome}</code></div>
        <div><span>Web 端口</span><code>{runtime.port ? `${runtime.port}（当前）` : `${settings.webPort}（首选）`}</code></div>
      </div>

      <section className="log-panel">
        <header><div><SquareTerminal size={17} /><strong>运行日志</strong><span>{logs.length} 条</span></div><button type="button" onClick={onClearLogs} disabled={logs.length === 0}>清空</button></header>
        <div className="log-output" role="log" aria-live="polite">
          {logs.length === 0 ? (
            <div className="log-empty"><SquareTerminal size={22} /><span>启动 DSH 后，输出会显示在这里。</span></div>
          ) : logs.map((log, index) => (
            <div className={`log-line ${log.level}`} key={`${log.timestamp}-${index}`}>
              <time>{new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</time>
              <span className="log-channel">{log.channel === 'plugin' ? 'PLUGIN' : 'DSH'}</span>
              <pre>{log.text}</pre>
            </div>
          ))}
          <div ref={logEnd} />
        </div>
      </section>
    </div>
  )
}
