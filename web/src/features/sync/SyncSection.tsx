import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OfflineHint } from '@/components/OfflineHint'
import { Button } from '@/components/ui/button'
import { useMeta } from '@/db/hooks'
import type { SyncLogEntry } from '@/db/meta'
import { errorMessage } from '@/lib/apiErrors'
import { formatNumber, relativeTime } from '@/lib/intl'
import { SettingsGroup, SettingsRow } from '../settings/SettingsList'
import { syncNow } from './engine'
import { useSyncStatus } from './useSyncStatus'

/** S-15 sync block: last sync, pending changes, Sync now, clock-skew warning and the log of the last 10 runs. */
export function SyncSection() {
  const { t, i18n } = useTranslation()
  const status = useSyncStatus()
  const log = useMeta('sync_log') ?? []
  const skew = useMeta('clock_skew_ms')
  if (!status) return null
  const number = (value: number) => formatNumber(value, i18n.language)

  return (
    <SettingsGroup title={t('sync.section')}>
      <SettingsRow label={t('sync.lastSync')}>
        <span className="text-muted-foreground">
          {status.lastSyncAt ? relativeTime(status.lastSyncAt, i18n.language) : t('sync.never')}
        </span>
      </SettingsRow>
      <SettingsRow label={t('sync.pending')}>
        <span className="text-muted-foreground tabular-nums" data-testid="pending-count">
          {number(status.pendingCount)}
        </span>
      </SettingsRow>
      {skew != null && (
        <p role="alert" className="px-4 py-3 text-sm text-hard">
          {t('sync.clockSkew', { minutes: number(Math.round(Math.abs(skew) / 60_000)) })}
        </p>
      )}
      <div className="p-4">
        <OfflineHint>
          {(offline) => (
            <Button
              size="xl"
              className="w-full"
              disabled={offline || status.state === 'syncing'}
              onClick={() => void syncNow('manual')}
            >
              <RefreshCw className={status.state === 'syncing' ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
              {t(status.state === 'syncing' ? 'sync.syncing' : 'sync.syncNow')}
            </Button>
          )}
        </OfflineHint>
      </div>
      {log.length > 0 && (
        <details className="px-4 py-3">
          <summary className="min-h-8 cursor-pointer">{t('sync.log')}</summary>
          <ol className="mt-2 flex flex-col gap-3" aria-label={t('sync.log')}>
            {log.map((entry) => (
              <LogEntry key={entry.started_at} entry={entry} />
            ))}
          </ol>
        </details>
      )}
    </SettingsGroup>
  )
}

function LogEntry({ entry }: { entry: SyncLogEntry }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const when = relativeTime(entry.finished_at, i18n.language)
  return (
    <li className="flex flex-col gap-1 text-sm">
      <span className={entry.status === 'error' ? 'text-destructive' : undefined}>
        {entry.status === 'ok'
          ? t('sync.logOk', { when, pushed: entry.pushed, pulled: entry.pulled })
          : t('sync.logError', { when, error: errorMessage(entry.error_code ?? 'unknown') })}
      </span>
      {entry.rejected.length > 0 && (
        <span className="flex flex-col gap-1">
          <span className="text-destructive">{t('sync.rejected', { count: entry.rejected.length })}</span>
          <Button variant="link" size="sm" className="self-start px-0" onClick={() => setOpen((shown) => !shown)}>
            {t('sync.details')}
          </Button>
          {open && (
            <ul className="font-mono text-xs break-all text-muted-foreground">
              {entry.rejected.map((row) => (
                <li key={`${row.entity}:${row.id}`}>
                  {row.entity} · {row.id} · {row.code}
                </li>
              ))}
            </ul>
          )}
        </span>
      )}
    </li>
  )
}
