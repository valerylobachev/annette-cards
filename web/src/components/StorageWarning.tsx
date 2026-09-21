import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useMeta } from '@/db/hooks'
import { shareBackup } from '@/features/export/exportFiles'

/**
 * Shown when the browser refused persistent storage and there is no account to sync to (ui_ux.md §7): Safari
 * may delete the data, so offer a backup. A sign-in link joins it in Phase 2.
 */
export function StorageWarning() {
  const { t } = useTranslation()
  const persisted = useMeta('storage_persisted')
  const account = useMeta('account')
  if (persisted !== false || account) return null
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-hard/40 bg-hard/10 p-4">
      <p className="flex gap-2">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-hard" aria-hidden />
        {t('storage.warning')}
      </p>
      <Button variant="outline" size="lg" className="self-start" onClick={() => void shareBackup()}>
        {t('storage.export')}
      </Button>
    </div>
  )
}
