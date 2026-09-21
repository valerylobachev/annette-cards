import { ArrowDown, Loader2 } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAccount } from '../auth/account'
import { syncNow } from './engine'

/** Pull distance (px) that starts a sync when released. */
const THRESHOLD = 70

/**
 * Pull down from the top of the page to sync now (ui_ux.md §6, Today). Only when signed in; otherwise the children
 * render unchanged.
 */
export function PullToSync({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const signedIn = Boolean(useAccount()?.account)
  const start = useRef<number | null>(null)
  const [distance, setDistance] = useState(0)
  const [syncing, setSyncing] = useState(false)

  if (!signedIn) return <>{children}</>

  function onTouchStart(event: React.TouchEvent) {
    start.current = window.scrollY <= 0 ? (event.touches[0]?.clientY ?? null) : null
  }

  function onTouchMove(event: React.TouchEvent) {
    if (start.current === null) return
    const y = event.touches[0]?.clientY ?? start.current
    setDistance(Math.max(0, Math.min(y - start.current, THRESHOLD * 1.5)))
  }

  async function onTouchEnd() {
    const pulled = distance >= THRESHOLD
    start.current = null
    setDistance(0)
    if (!pulled) return
    setSyncing(true)
    try {
      await syncNow('manual')
    } finally {
      setSyncing(false)
    }
  }

  const visible = syncing || distance > 0
  return (
    <div data-pull-to-sync onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={() => void onTouchEnd()}>
      {visible && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
          style={{ height: syncing ? 40 : distance / 1.5 }}
        >
          {syncing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <ArrowDown className="size-4" aria-hidden />
          )}
          {t(syncing ? 'sync.syncing' : distance >= THRESHOLD ? 'sync.releaseToSync' : 'sync.pullToSync')}
        </div>
      )}
      {children}
    </div>
  )
}
