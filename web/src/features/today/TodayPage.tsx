import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Flame } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/EmptyState'
import { StorageWarning } from '@/components/StorageWarning'
import { Button } from '@/components/ui/button'
import { useToday } from '@/db/hooks'
import type { TodayData } from '@/db/studyQueries'
import { addExtraNew } from '@/db/studyQueries'
import { QuickAddButton } from '@/features/cards/QuickAddSheet'
import { now } from '@/lib/clock'
import { relativeTime } from '@/lib/intl'
import { cn } from '@/lib/utils'

/** S-04 Today: what to study now, the streak and the decks with cards due (UC-08). No mode chips until Phase 4. */
export function TodayPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const today = useToday()

  // Dexie answers within a few ms: render nothing instead of a skeleton (ui_ux.md S-04).
  if (!today) return null

  const empty =
    !today.hasHistory &&
    today.reviewsDue + today.newAvailable === 0 &&
    !today.moreNewWaiting &&
    today.nextDueAt === null

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pt-4">
      <header className="flex min-h-11 items-center">
        <h1 className="text-2xl font-semibold">{t('today.greeting')}</h1>
      </header>
      <StorageWarning />
      {empty ? (
        <EmptyState
          message={t('today.empty')}
          actionLabel={t('today.goToDecks')}
          onAction={() => navigate({ to: '/decks' })}
        />
      ) : (
        <>
          <Hero today={today} />
          <StreakRow streak={today.streak} last7={today.last7} />
          {today.decksDue.length > 0 && <DecksDue decksDue={today.decksDue} />}
        </>
      )}
      <QuickAddButton />
    </div>
  )
}

function Hero({ today }: { today: TodayData }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const hasCards = today.reviewsDue + today.newAvailable > 0

  async function learnExtra() {
    await addExtraNew(now())
    navigate({ to: '/study' })
  }

  return (
    <section className="flex flex-col gap-3 rounded-3xl border bg-card p-5 shadow-sm">
      {hasCards ? (
        <>
          <p className="text-xl font-semibold">
            {today.hasHistory && <>{t('today.toReview', { count: today.reviewsDue })} · </>}
            {t('today.newCount', { count: today.newAvailable })}
          </p>
          <p className="text-muted-foreground">{t('today.estimate', { count: today.estimateMin })}</p>
          <Button size="xl" className="mt-2 w-full" onClick={() => navigate({ to: '/study' })}>
            {t('today.start')}
          </Button>
        </>
      ) : (
        <>
          <p className="text-lg">
            {t('today.nothingDue')}{' '}
            {today.nextDueAt !== null &&
              t('today.nextReviews', { when: relativeTime(today.nextDueAt, i18n.language, now()) })}
          </p>
          {today.moreNewWaiting && (
            <Button size="xl" variant="secondary" className="w-full" onClick={learnExtra}>
              {t('today.learnExtra')}
            </Button>
          )}
          {today.practiceAvailable && (
            <Button size="xl" variant="secondary" className="w-full" asChild>
              <Link to="/study" search={{ practice: 1 }}>
                {t('today.practice')}
              </Link>
            </Button>
          )}
        </>
      )}
    </section>
  )
}

function StreakRow({ streak, last7 }: { streak: number; last7: boolean[] }) {
  const { t } = useTranslation()
  const studied = last7.filter(Boolean).length
  return (
    <section aria-label={t('today.streakLabel')} className="flex items-center gap-3 px-1">
      <Flame className={cn('size-6', streak > 0 ? 'text-hard' : 'text-muted-foreground')} aria-hidden />
      <p className="flex-1 font-medium">{t('today.streak', { count: streak })}</p>
      <div role="img" aria-label={t('today.last7', { count: studied })} className="flex gap-1.5">
        {last7.map((done, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed 7 positions, oldest to today
            key={index}
            className={cn('size-2.5 rounded-full', done ? 'bg-hard' : 'bg-secondary')}
          />
        ))}
      </div>
    </section>
  )
}

function DecksDue({ decksDue }: { decksDue: TodayData['decksDue'] }) {
  const { t } = useTranslation()
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 font-medium">{t('today.decksDue')}</h2>
      <ul className="flex flex-col divide-y rounded-2xl border bg-card">
        {decksDue.map(({ deck, due }) => (
          <li key={deck.id}>
            <Link
              to="/study"
              search={{ deck: deck.id }}
              className="flex min-h-14 items-center gap-3 px-4 py-2 active:bg-muted"
            >
              <span className="min-w-0 flex-1 truncate">{deck.name}</span>
              <span className="text-xs font-medium text-muted-foreground">
                {deck.target_lang.split('-')[0]?.toUpperCase()}
              </span>
              <span className="text-sm text-muted-foreground">{t('decks.due', { count: due })}</span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
