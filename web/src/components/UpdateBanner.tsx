import { useRegisterSW } from 'virtual:pwa-register/react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/** "A new version is available · Reload" when the service worker has an update (ui_ux.md §4). */
export function UpdateBanner() {
  const { t } = useTranslation()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-primary px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-primary-foreground"
    >
      <span>{t('update.available')}</span>
      <Button variant="secondary" size="lg" onClick={() => updateServiceWorker(true)}>
        {t('update.reload')}
      </Button>
    </div>
  )
}
