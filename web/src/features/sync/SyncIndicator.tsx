import { Link } from '@tanstack/react-router'
import { Cloud, CloudAlert, CloudCheck, CloudOff, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/lib/intl'
import { cn } from '@/lib/utils'
import { type SyncState, useSyncStatus } from './useSyncStatus'

const ICONS: Record<Exclude<SyncState, 'signed_out'>, typeof Cloud> = {
  synced: CloudCheck,
  syncing: Loader2,
  pending: Cloud,
  offline: CloudOff,
  error: CloudAlert,
}

/**
 * Top-bar sync indicator of Today and Settings (ui_ux.md §4): synced, syncing, pending changes with their count,
 * offline, error. Opens Account & sync; hidden when signed out.
 */
export function SyncIndicator() {
  const { t, i18n } = useTranslation()
  const status = useSyncStatus()
  if (!status || status.state === 'signed_out') return null

  const Icon = ICONS[status.state]
  const label = t(`sync.status.${status.state}`, { count: status.pendingCount })
  return (
    <Link
      to="/settings/account"
      aria-label={label}
      title={label}
      data-state={status.state}
      className="relative inline-flex size-11 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
    >
      <Icon
        className={cn(
          'size-6',
          status.state === 'syncing' && 'animate-spin',
          status.state === 'error' && 'text-destructive',
        )}
        aria-hidden
      />
      {status.state === 'pending' && (
        <span className="absolute top-1 right-0 min-w-5 rounded-full bg-primary px-1 text-center text-xs font-semibold text-primary-foreground tabular-nums">
          {formatNumber(status.pendingCount, i18n.language)}
        </span>
      )}
      {status.state === 'error' && <span className="absolute top-2 right-2 size-2.5 rounded-full bg-destructive" />}
    </Link>
  )
}
