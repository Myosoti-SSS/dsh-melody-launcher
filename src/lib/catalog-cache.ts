import type { CatalogRepositoryAnalysis } from '../types'

const STORAGE_KEY = 'dsh-launcher.catalog-analysis.v2'
const memoryCache = new Map<string, CatalogCacheEntry>()

export interface CatalogCacheEntry {
  repository: string
  defaultBranch: string
  analysis: CatalogRepositoryAnalysis
  cachedAt: number
}

function cacheKey(repository: string, defaultBranch: string): string {
  return `${repository.toLowerCase()}#${defaultBranch}`
}

function readStorage(): Record<string, CatalogCacheEntry> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, CatalogCacheEntry>
  } catch {
    return {}
  }
}

function writeStorage(entries: Record<string, CatalogCacheEntry>): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Private browsing and quota errors fall back to the in-memory cache.
  }
}

export function readCatalogAnalysisCache(
  repository: string,
  defaultBranch: string,
  maxAgeMs = 24 * 60 * 60 * 1000,
): CatalogRepositoryAnalysis | null {
  const key = cacheKey(repository, defaultBranch)
  const stored = readStorage()[key] ?? memoryCache.get(key)
  if (!stored || Date.now() - stored.cachedAt > maxAgeMs || stored.repository.toLowerCase() !== repository.toLowerCase()) return null
  memoryCache.set(key, stored)
  return stored.analysis
}

export function writeCatalogAnalysisCache(
  repository: string,
  defaultBranch: string,
  analysis: CatalogRepositoryAnalysis,
): void {
  const key = cacheKey(repository, defaultBranch)
  const entry: CatalogCacheEntry = { repository, defaultBranch, analysis, cachedAt: Date.now() }
  memoryCache.set(key, entry)
  const entries = readStorage()
  entries[key] = entry
  writeStorage(entries)
}

export function clearCatalogAnalysisCache(): void {
  memoryCache.clear()
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}
