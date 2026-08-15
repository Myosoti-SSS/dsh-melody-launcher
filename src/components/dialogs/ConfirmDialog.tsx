import { Trash2 } from 'lucide-react'
import type { ManagedPlugin } from '../../types'

/** 卸载插件前的确认。 */
export function ConfirmDialog({ plugin, onCancel, onConfirm }: {
  plugin: ManagedPlugin
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-icon"><Trash2 size={22} /></div>
        <h2 id="confirm-title">卸载 {plugin.displayName}？</h2>
        <p>这会让官方 DSH CLI 从 <strong>web</strong> profile 中移除此依赖。仓库与其他 profile 不受影响。</p>
        <footer><button type="button" className="secondary-button" onClick={onCancel}>取消</button><button type="button" className="danger-button" onClick={onConfirm}><Trash2 size={16} />确认卸载</button></footer>
      </section>
    </div>
  )
}
