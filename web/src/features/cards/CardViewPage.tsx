import { Link, useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { ChevronLeft, Pencil, RotateCcw, Trash2, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { useSnackbar } from '@/components/Snackbar'
import { Button } from '@/components/ui/button'
import { resetProgress } from '@/db/cardStates'
import { deleteCard, undeleteCards } from '@/db/cards'
import { useCard, useCardStates, useDeck, useRecentReviews } from '@/db/hooks'
import { activeDirections } from '@/domain/directions'
import type { Card, CardState, Deck, Direction, Rating } from '@/domain/types'
import { formatNumber, relativeTime } from '@/lib/intl'
import { useSpeech } from '@/lib/speech/useSpeech'
import { cn } from '@/lib/utils'
import { PronunciationSection } from './PronunciationSection'

const ratingDotClass: Record<Rating, string> = {
  1: 'bg-red-500',
  2: 'bg-amber-400',
  3: 'bg-green-500',
  4: 'bg-blue-500',
}

/** S-07 Card view. */
export function CardViewPage() {
  const { t } = useTranslation()
  const { cardId } = useParams({ from: '/cards/$cardId' })
  const card = useCard(cardId)
  if (card === undefined) return null
  if (card === null) return <p className="px-4 py-16 text-center text-muted-foreground">{t('card.notFound')}</p>
  return <CardDeckLoader card={card} />
}

function CardDeckLoader({ card }: { card: Card }) {
  const { t } = useTranslation()
  const deck = useDeck(card.deck_id)
  if (deck === undefined) return null
  if (deck === null) return <p className="px-4 py-16 text-center text-muted-foreground">{t('card.notFound')}</p>
  return <CardView card={card} deck={deck} />
}

export function CardView({ card, deck }: { card: Card; deck: Deck }) {
  const { t } = useTranslation()
  const router = useRouter()
  const navigate = useNavigate()
  const snackbar = useSnackbar()
  const states = useCardStates(card.id)
  const { speak, pronounce } = useSpeech()
  const [confirm, setConfirm] = useState<'reset' | 'delete' | null>(null)

  function goBack() {
    if (router.history.canGoBack()) router.history.back()
    else navigate({ to: '/decks/$deckId', params: { deckId: card.deck_id } })
  }

  async function remove() {
    const deletedAt = await deleteCard(card.id)
    navigate({ to: '/decks/$deckId', params: { deckId: card.deck_id }, replace: true })
    snackbar.show({
      message: t('snackbar.cardDeleted'),
      actionLabel: t('common.undo'),
      onAction: () => undeleteCards([card.id], deletedAt),
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pt-2 pb-8">
      <header className="-mx-2 flex min-h-14 items-center gap-1">
        <Button variant="ghost" size="icon-xl" aria-label={t('common.back')} onClick={goBack}>
          <ChevronLeft className="size-6" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{deck.name}</span>
        <Button asChild variant="ghost" size="xl">
          <Link to="/cards/$cardId/edit" params={{ cardId: card.id }}>
            <Pencil className="size-4" aria-hidden />
            {t('card.edit')}
          </Link>
        </Button>
      </header>

      <section className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold break-words">
          <button
            type="button"
            lang={deck.target_lang}
            className="inline-flex items-start gap-2 text-left"
            onClick={() => void pronounce(card.front, deck.target_lang, card.audio_id)}
          >
            {card.front}
            <Volume2 className="mt-2 size-6 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </h1>
        {card.ipa && <p className="text-lg text-muted-foreground">[{card.ipa}]</p>}
        <p lang={deck.native_lang} className="text-2xl break-words">
          {card.back}
        </p>
      </section>

      {card.example && (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-muted-foreground">{t('card.example')}</h2>
          <button
            type="button"
            lang={deck.target_lang}
            className="inline-flex items-start gap-2 text-left italic"
            onClick={() => card.example && void speak(card.example, deck.target_lang)}
          >
            {card.example}
            <Volume2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
          {card.example_translation && (
            <p lang={deck.native_lang} className="text-muted-foreground">
              {card.example_translation}
            </p>
          )}
        </section>
      )}

      {card.tags.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-muted-foreground">{t('card.tags')}</h2>
          <ul className="flex flex-wrap gap-1.5">
            {card.tags.map((tag) => (
              <li key={tag} className="rounded-full bg-secondary px-3 py-1 text-sm">
                #{tag}
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.notes && (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-muted-foreground">{t('card.notes')}</h2>
          <p className="whitespace-pre-wrap">{card.notes}</p>
        </section>
      )}

      <PronunciationSection card={card} deck={deck} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('card.progress')}</h2>
        {activeDirections(deck.directions).map((direction) => (
          <DirectionProgress
            key={direction}
            cardId={card.id}
            direction={direction}
            state={states?.find((state) => state.direction === direction)}
          />
        ))}
      </section>

      <div className="flex flex-col gap-2">
        <Button size="xl" variant="secondary" onClick={() => setConfirm('reset')}>
          <RotateCcw className="size-4" aria-hidden />
          {t('card.reset')}
        </Button>
        <Button size="xl" variant="destructive" onClick={() => setConfirm('delete')}>
          <Trash2 className="size-4" aria-hidden />
          {t('card.delete')}
        </Button>
      </div>

      <ConfirmSheet
        open={confirm === 'reset'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('card.resetConfirm')}
        description={t('deck.bulk.resetHint')}
        confirmLabel={t('card.reset')}
        onConfirm={async () => {
          await resetProgress([card.id])
          snackbar.show({ message: t('snackbar.progressReset') })
        }}
      />
      <ConfirmSheet
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('card.deleteConfirm')}
        confirmLabel={t('common.delete')}
        onConfirm={remove}
      />
    </div>
  )
}

type ProgressProps = { cardId: string; direction: Direction; state: CardState | undefined }

/** One direction's schedule and its last 10 answers (S-07 Progress). */
function DirectionProgress({ cardId, direction, state }: ProgressProps) {
  const { t, i18n } = useTranslation()
  const reviews = useRecentReviews(cardId, direction)
  const studied = state !== undefined && state.state !== 0
  const number = (value: number) => formatNumber(Math.round(value * 100) / 100, i18n.language)

  return (
    <article aria-label={t(`card.${direction}`)} className="flex flex-col gap-3 rounded-2xl border p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">{t(`card.${direction}`)}</h3>
        <span className="text-sm text-muted-foreground">{t(`card.states.${state?.state ?? 0}`)}</span>
      </header>
      {studied && state ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="col-span-2 flex justify-between">
            <dt className="text-muted-foreground">{t('card.nextDue')}</dt>
            <dd>{relativeTime(state.due, i18n.language)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('card.stability')}</dt>
            <dd>{t('card.days', { count: Math.round(state.stability) })}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('card.difficulty')}</dt>
            <dd>{number(state.difficulty)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('card.reps')}</dt>
            <dd>{number(state.reps)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('card.lapses')}</dt>
            <dd>{number(state.lapses)}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">{t('card.notStudied')}</p>
      )}
      <div className="flex flex-col gap-1">
        <h4 className="text-sm text-muted-foreground">{t('card.history')}</h4>
        {reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('card.noHistory')}</p>
        ) : (
          <ol className="flex gap-1.5">
            {/* Oldest first, so the newest answer is on the right. */}
            {[...reviews].reverse().map((review) => (
              <li key={review.id} className={cn('size-3 rounded-full', ratingDotClass[review.rating])}>
                <span className="sr-only">{t(`card.ratings.${review.rating}`)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </article>
  )
}
