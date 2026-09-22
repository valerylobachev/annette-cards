import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { optimize } from '@/api/endpoints/fsrs/fsrs'
import type { OptimizeResponse } from '@/api/model'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useSettings } from '@/db/hooks'
import { applyFsrsWeights, resetFsrsWeights } from '@/db/settings'
import { useAccount } from '@/features/auth/account'
import { syncNow } from '@/features/sync/engine'
import { ApiError, callApi } from '@/lib/api'
import { errorMessageKey } from '@/lib/apiErrors'
import { formatPercent } from '@/lib/intl'
import { useOnline } from '@/lib/useOnline'
import { SettingsRow } from './SettingsList'

/**
 * S-14 Study → FSRS weights (UC-30): default or optimized (with the date), **Optimize** (the server fits weights to
 * the synced history; the result is shown before anything changes) and **Reset to default**.
 */
export function FsrsWeightsRow() {
  const { t, i18n } = useTranslation()
  const { fsrs_weights, fsrs_optimized_at } = useSettings()
  const account = useAccount()
  const online = useOnline()
  const [result, setResult] = useState<OptimizeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const optimization = useMutation({
    mutationFn: async () => {
      // The server fits the weights to the history it has: send this device's latest answers first.
      await syncNow('manual')
      return callApi(() => optimize())
    },
    onMutate: () => setError(null),
    onSuccess: setResult,
    onError: (err) => {
      const apiError = err instanceof ApiError ? err : new ApiError(0, 'unknown')
      // `not_enough_reviews` carries `{ count, required }` for its message.
      const details = typeof apiError.details === 'object' && apiError.details !== null ? apiError.details : {}
      setError(t(errorMessageKey(apiError.code), details as Record<string, unknown>))
    },
  })

  const blocker = account?.account === null ? t('settings.fsrs.signIn') : !online ? t('offline.availableOnline') : null
  const status =
    fsrs_weights && fsrs_optimized_at !== null
      ? t('settings.fsrs.optimizedOn', { date: new Date(fsrs_optimized_at).toLocaleDateString(i18n.language) })
      : t('settings.fsrs.default')

  return (
    <SettingsRow
      label={
        <span className="flex justify-between gap-2">
          {t('settings.fsrs.title')}
          <span className="text-muted-foreground">{status}</span>
        </span>
      }
      hint={blocker ?? t('settings.fsrs.hint')}
      stacked
    >
      <div className="flex flex-wrap gap-2">
        <Button
          size="lg"
          variant="outline"
          disabled={blocker !== null || !account?.account || optimization.isPending}
          onClick={() => optimization.mutate()}
        >
          {t(optimization.isPending ? 'settings.fsrs.optimizing' : 'settings.fsrs.optimize')}
        </Button>
        {fsrs_weights && (
          <Button size="lg" variant="ghost" onClick={() => void resetFsrsWeights()}>
            {t('settings.fsrs.reset')}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ResultSheet
        result={result}
        onClose={() => setResult(null)}
        onApply={(weights) => {
          void applyFsrsWeights(weights)
          setResult(null)
        }}
      />
    </SettingsRow>
  )
}

type ResultSheetProps = {
  result: OptimizeResponse | null
  onClose: () => void
  onApply: (weights: number[]) => void
}

/** The fitted weights compared with the defaults (log loss: lower is better); Apply or Cancel. */
function ResultSheet({ result, onClose, onApply }: ResultSheetProps) {
  const { t, i18n } = useTranslation()
  const loss = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 }).format(value)
  const improvement = result ? (result.log_loss_default - result.log_loss_optimized) / result.log_loss_default : 0

  return (
    <Sheet open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" showCloseButton={false} className="mx-auto max-w-[480px]">
        {result && (
          <>
            <SheetHeader>
              <SheetTitle className="text-lg">{t('settings.fsrs.resultTitle')}</SheetTitle>
              <SheetDescription>{t('settings.fsrs.reviews', { count: result.review_count })}</SheetDescription>
            </SheetHeader>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 px-4 text-sm">
              <dt>{t('settings.fsrs.lossDefault')}</dt>
              <dd className="text-right tabular-nums">{loss(result.log_loss_default)}</dd>
              <dt>{t('settings.fsrs.lossOptimized')}</dt>
              <dd className="text-right tabular-nums">{loss(result.log_loss_optimized)}</dd>
            </dl>
            <p className="px-4 font-medium">
              {improvement > 0
                ? t('settings.fsrs.better', { value: formatPercent(improvement, i18n.language) })
                : t('settings.fsrs.notBetter')}
            </p>
            <p className="px-4 text-sm text-muted-foreground">{t('settings.fsrs.applyHint')}</p>
            <SheetFooter>
              <Button size="xl" onClick={() => onApply(result.weights)}>
                {t('settings.fsrs.apply')}
              </Button>
              <Button size="xl" variant="secondary" onClick={onClose}>
                {t('common.cancel')}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
