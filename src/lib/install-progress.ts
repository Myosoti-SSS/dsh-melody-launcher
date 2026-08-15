import type { InstallProgress } from '../types'

export function isInstallProgressActive(progress: InstallProgress | null): progress is InstallProgress {
  return progress != null && progress.phase !== 'complete' && progress.phase !== 'error'
}
