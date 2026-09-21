import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useOnline } from '@/lib/useOnline'

/**
 * Wraps a server-only action (ui_ux.md §4, §7). Offline, the action is rendered disabled with the caption
 * "Available online" under it; `children` receives whether it must be disabled.
 */
export function OfflineHint({ children }: { children: (offline: boolean) => ReactNode }) {
  const { t } = useTranslation()
  const offline = !useOnline()
  return (
    <div className="flex flex-col gap-1">
      {children(offline)}
      {offline && <p className="text-sm text-muted-foreground">{t('offline.availableOnline')}</p>}
    </div>
  )
}
