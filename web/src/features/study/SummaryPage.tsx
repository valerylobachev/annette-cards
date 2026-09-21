import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { ChevronRight, Flame } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { useFinishedSession, useToday } from '@/db/hooks'
import { formatDuration, formatNumber, formatPercent } from '@/lib/intl'

/** S-12 Session summary: totals, the updated streak and the cards failed in the session. */
export function SummaryPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { session = '' } = useSearch({ from: '/study/summary' })
  const finished = useFinishedSession(session)
  const today = useToday()
  const done = () => navigate({ to: '/' })

  if (finished === undefined) return null
  if (finished === null) {
    return <EmptyState message={t('summary.missing')} actionLabel={t('summary.done')} onAction={done} />
  }

  const stats = [
    { label: t('summary.cardsReviewed'), value: formatNumber(finished.cardsReviewed, i18n.language) },
    { label: t('summary.accuracy'), value: formatPercent(finished.accuracy, i18n.language) },
    { label: t('summary.time'), value: formatDuration(finished.timeMs, i18n.language) },
    { label: t('summary.newLearned'), value: formatNumber(finished.newLearned, i18n.language) },
  ]

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-[480px] flex-col gap-6 px-4 pt-6 pb-4">
      <h1 className="text-2xl font-semibold">{t('screens.summary.title')}</h1>
      <dl className="grid grid-cols-2 gap-3">
        {stats.map(({ label, value }) => (
          <div key={label} className="flex flex-col-reverse gap-1 rounded-2xl border bg-card p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {today && (
        <p className="flex items-center gap-2 font-medium">
          <Flame className="size-5 text-hard" aria-hidden />
          {t('summary.streak')}: {t('today.streak', { count: today.streak })}
        </p>
      )}
      {finished.difficultCardIds.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">{t('summary.difficult')}</h2>
          <ul className="flex flex-col divide-y rounded-2xl border bg-card">
            {finished.difficultCardIds.map((id) => {
              const study = finished.cards.get(id)
              if (!study) return null
              return (
                <li key={id}>
                  <Link
                    to="/cards/$cardId"
                    params={{ cardId: id }}
                    className="flex min-h-12 items-center gap-3 px-4 py-2 active:bg-muted"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span lang={study.deck.target_lang} className="font-medium">
                        {study.card.front}
                      </span>{' '}
                      — <span lang={study.deck.native_lang}>{study.card.back}</span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <div className="mt-auto flex flex-col gap-2">
        {finished.difficultCardIds.length > 0 && (
          <Button size="xl" variant="secondary" asChild>
            <Link to="/study" search={{ practice: 1, repeat: finished.snapshot.id }}>
              {t('summary.repeat')}
            </Link>
          </Button>
        )}
        <Button size="xl" onClick={done}>
          {t('summary.done')}
        </Button>
      </div>
    </div>
  )
}
