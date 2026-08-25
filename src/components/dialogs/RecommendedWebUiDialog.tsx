import { Download, Settings, X } from 'lucide-react'

/** 官方推荐整合包（DSH Web UI）的首次询问弹窗。 */

export interface RecommendedWebUiDialogProps {
  kind: 'new' | 'existing'
  onDownload: () => void
  onDismiss: () => void
}

export function RecommendedWebUiDialog({ kind, onDownload, onDismiss }: RecommendedWebUiDialogProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onDismiss() }}>
      <section className="modal recommended-dialog" role="alertdialog" aria-modal="true" aria-labelledby="recommended-webui-title">
        <header><div><Settings size={19} /><h2 id="recommended-webui-title">官方推荐整合包</h2></div><button type="button" className="icon-button settings-close-button" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onDismiss() }} aria-label="关闭"><X size={18} /></button></header>
        <div className="modal-content">
          <p className="recommended-dialog-copy">
            {kind === 'new'
              ? '是否同时下载官方推荐的「DSH Web UI」全家桶整合包，以获得更佳使用体验？（后续可在启动项管理中关闭）'
              : '建议下载并启用官方推荐的「DSH Web UI」全家桶整合包。注意：首次启用将默认暂时停用您已安装的其它插件，以免兼容性冲突；之后可在启动项管理中重新开启。'}
          </p>
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onDismiss}>暂不</button>
          <button type="button" className="primary-command" onClick={onDownload}>{kind === 'new' ? <Download size={17} /> : <Download size={17} />}{kind === 'new' ? '下载' : '下载并启用'}</button>
        </footer>
      </section>
    </div>
  )
}