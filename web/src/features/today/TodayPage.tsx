import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Flame } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/EmptyState'
import { StorageWarning } from '@/components/StorageWarning'
import { Button } from '@/components/ui/button'
import { useMeta, useSettings, useToday } from '@/db/hooks'
import { setMeta } from '@/db/meta'
import type { TodayData } from '@/db/studyQueries'
import { addExtraNew } from '@/db/studyQueries'
import type { StudyMode } from '@/domain/types'
import { useAccount } from '@/features/auth/account'
import { QuickAddButton } from '@/features/cards/QuickAddSheet'
import { PullToSync } from '@/features/sync/PullToSync'
import { SyncIndicator } from '@/features/sync/SyncIndicator'
import { now } from '@/lib/clock'
import { relativeTime } from '@/lib/intl'
import { cn } from '@/lib/utils'

/** S-04 Today: what to study now with the mode chips, the streak and the decks with cards due (UC-08). */
export function TodayPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const today = useToday()
  const name = useAccount()?.account?.display_name
  const settings = useSettings()
  const storedMode = useMeta('study_mode') ?? 'swipe'

  // Dexie answers within a few ms: render nothing instead of a skeleton (ui_ux.md S-04).
  if (!today) return null

  const unavailable = unavailableModes(today.choiceAvailable, settings.listening_answer === 'choose')
  const mode = unavailable.includes(storedMode) ? 'swipe' : storedMode
  const modeSearch = mode === 'swipe' ? {} : { mode }

  const empty =
    !today.hasHistory &&
    today.reviewsDue + today.newAvailable === 0 &&
    !today.moreNewWaiting &&
    today.nextDueAt === null

  return (
    <PullToSync>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pt-4 pb-24">
        <header className="flex min-h-11 items-center justify-between gap-2">
          <h1 className="truncate text-2xl font-semibold">
            {name ? t('today.greetingName', { name }) : t('today.greeting')}
          </h1>
          <SyncIndicator />
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
            <Hero today={today} modeSearch={modeSearch} chips={<ModeChips value={mode} unavailable={unavailable} />} />
            <StreakRow streak={today.streak} last7={today.last7} />
            {today.decksDue.length > 0 && <DecksDue decksDue={today.decksDue} modeSearch={modeSearch} />}
          </>
        )}
        <QuickAddButton />
      </div>
    </PullToSync>
  )
}

/** The mode of the sessions started from Today: `{ mode }` in the `/study` search, nothing for swipe. */
type ModeSearch = { mode?: StudyMode }

type HeroProps = { today: TodayData; modeSearch: ModeSearch; chips: ReactNode }

function Hero({ today, modeSearch, chips }: HeroProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const hasCards = today.reviewsDue + today.newAvailable > 0

  async function learnExtra() {
    await addExtraNew(now())
    navigate({ to: '/study', search: modeSearch })
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
          <Button size="xl" className="mt-2 w-full" onClick={() => navigate({ to: '/study', search: modeSearch })}>
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
              <Link to="/study" search={{ practice: 1, ...modeSearch }}>
                {t('today.practice')}
              </Link>
            </Button>
          )}
        </>
      )}
      {(hasCards || today.moreNewWaiting || today.practiceAvailable) && chips}
    </section>
  )
}

const MODES: StudyMode[] = ['swipe', 'choice', 'listening', 'typing']

/** Modes that cannot be offered: multiple choice, and listening with written options, need four words (UC-14). */
function unavailableModes(choiceAvailable: boolean, listeningWithOptions: boolean): StudyMode[] {
  if (choiceAvailable) return []
  return listeningWithOptions ? ['choice', 'listening'] : ['choice']
}

/** The mode chips under Start (S-04); the choice is kept on this device (`meta.study_mode`). */
function ModeChips({ value, unavailable }: { value: StudyMode; unavailable: StudyMode[] }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">{t('study.modes.label')}</legend>
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={mode === value}
            disabled={unavailable.includes(mode)}
            onClick={() => void setMeta('study_mode', mode)}
            className={cn(
              'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors disabled:opacity-50',
              mode === value ? 'border-primary bg-primary text-primary-foreground' : 'bg-background active:bg-muted',
            )}
          >
            {t(`study.modes.${mode}`)}
          </button>
        ))}
      </fieldset>
      {unavailable.length > 0 && <p className="text-sm text-muted-foreground">{t('study.modes.notEnoughCards')}</p>}
    </div>
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

function DecksDue({ decksDue, modeSearch }: { decksDue: TodayData['decksDue']; modeSearch: ModeSearch }) {
  const { t } = useTranslation()
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 font-medium">{t('today.decksDue')}</h2>
      <ul className="flex flex-col divide-y rounded-2xl border bg-card">
        {decksDue.map(({ deck, due }) => (
          <li key={deck.id}>
            <Link
              to="/study"
              search={{ deck: deck.id, ...modeSearch }}
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
