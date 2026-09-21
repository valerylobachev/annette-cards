import { useNavigate } from '@tanstack/react-router'
import { Download, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { useSnackbar } from '@/components/Snackbar'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { restoreAsNew, restoreReplace } from '@/db/backup'
import { type BackupV1, backupCounts, parseBackup } from '@/domain/backup/format'
import { shareBackup } from '@/features/export/exportFiles'
import { formatNumber } from '@/lib/intl'
import { SettingsGroup } from './SettingsList'

/** S-14 Data: export a full backup and restore one (UC-24, UC-25); CSV per deck is in the deck menus. */
export function DataSection() {
  const { t } = useTranslation()
  const fileInput = useRef<HTMLInputElement>(null)
  const [backup, setBackup] = useState<BackupV1 | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pick(file: File | undefined) {
    if (!file) return
    setError(null)
    let json: unknown
    try {
      json = JSON.parse(await file.text())
    } catch {
      json = null
    }
    const result = parseBackup(json)
    if (result.ok) setBackup(result.backup)
    else if (result.code === 'unsupported_version') {
      setError(t('backup.errors.unsupportedVersion', { version: result.required_version }))
    } else setError(t('backup.errors.invalidFormat'))
  }

  return (
    <SettingsGroup title={t('backup.section')}>
      <div className="flex flex-col gap-2 p-4">
        <Button size="xl" variant="outline" className="justify-start" onClick={() => shareBackup()}>
          <Download className="size-4" aria-hidden />
          {t('backup.export')}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          aria-label={t('backup.import')}
          className="sr-only"
          onChange={(event) => {
            void pick(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        <Button size="xl" variant="outline" className="justify-start" onClick={() => fileInput.current?.click()}>
          <Upload className="size-4" aria-hidden />
          {t('backup.import')}
        </Button>
        <p className="text-sm text-muted-foreground">{t('backup.hint')}</p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <RestoreSheet backup={backup} onClose={() => setBackup(null)} />
    </SettingsGroup>
  )
}

function RestoreSheet({ backup, onClose }: { backup: BackupV1 | null; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const snackbar = useSnackbar()
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const counts = backup ? backupCounts(backup) : null
  const number = (value: number) => formatNumber(value, i18n.language)

  async function restore(run: (backup: BackupV1) => Promise<void>) {
    if (!backup) return
    setBusy(true)
    try {
      await run(backup)
      onClose()
      snackbar.show({ message: t('backup.restored') })
      navigate({ to: '/decks' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Sheet open={backup !== null && !confirmReplace && !busy} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="bottom" className="mx-auto max-w-[720px]">
          <SheetHeader>
            <SheetTitle className="text-lg">{t('backup.restoreTitle')}</SheetTitle>
            <SheetDescription>
              {counts &&
                t('backup.counts', {
                  decks: t('backup.decks', { count: counts.decks, formatted: number(counts.decks) }),
                  cards: t('backup.cards', { count: counts.cards, formatted: number(counts.cards) }),
                  reviews: t('backup.reviews', { count: counts.reviews, formatted: number(counts.reviews) }),
                })}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4 pb-4">
            <Button size="xl" disabled={busy} onClick={() => restore(restoreAsNew)}>
              {t('backup.addAsNew')}
            </Button>
            <Button size="xl" variant="destructive" disabled={busy} onClick={() => setConfirmReplace(true)}>
              {t('backup.replace')}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <ConfirmSheet
        open={confirmReplace}
        onOpenChange={setConfirmReplace}
        title={t('backup.replaceConfirm')}
        description={t('backup.replaceHint')}
        confirmLabel={t('backup.replace')}
        onConfirm={() => restore(restoreReplace)}
      />
    </>
  )
}
