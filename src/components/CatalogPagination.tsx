import { ChevronLeft, ChevronRight } from 'lucide-react'

/** GitHub 检索结果的分页条，插件与 Skill 两个发现页共用。 */

const CATALOG_PAGE_SIZE = 30
const GITHUB_SEARCH_RESULT_LIMIT = 1000

interface CatalogPaginationProps {
  page: number
  total: number
  loading: boolean
  disabled: boolean
  onPageChange: (page: number) => void
}

export function CatalogPagination({ page, total, loading, disabled, onPageChange }: CatalogPaginationProps) {
  const accessibleTotal = Math.min(total, GITHUB_SEARCH_RESULT_LIMIT)
  const pageCount = Math.max(1, Math.ceil(accessibleTotal / CATALOG_PAGE_SIZE))
  const rangeStart = accessibleTotal === 0 ? 0 : (page - 1) * CATALOG_PAGE_SIZE + 1
  const rangeEnd = Math.min(page * CATALOG_PAGE_SIZE, accessibleTotal)
  const controlsDisabled = loading || disabled

  return (
    <div className="catalog-pagination" role="navigation" aria-label="仓库分页">
      <p>
        当前显示 {rangeStart}-{rangeEnd}，可浏览 {accessibleTotal.toLocaleString('zh-CN')} 个仓库
        {total > GITHUB_SEARCH_RESULT_LIMIT && <>；GitHub 搜索最多开放前 {GITHUB_SEARCH_RESULT_LIMIT.toLocaleString('zh-CN')} 个</>}
      </p>
      <div className="catalog-page-controls">
        <button type="button" disabled={controlsDisabled || page <= 1} onClick={() => onPageChange(page - 1)} aria-label="上一页" title="上一页"><ChevronLeft size={17} /></button>
        <span aria-live="polite">第 {page} / {pageCount} 页</span>
        <button type="button" disabled={controlsDisabled || page >= pageCount} onClick={() => onPageChange(page + 1)} aria-label="下一页" title="下一页"><ChevronRight size={17} /></button>
      </div>
    </div>
  )
}
