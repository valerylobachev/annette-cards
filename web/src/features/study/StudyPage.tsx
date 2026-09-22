import { Link, useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { Check, Undo2, VolumeX, X } from 'lucide-react'
import { motion } from 'motion/react'
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { EmptyState } from '@/components/EmptyState'
import { useSnackbar } from '@/components/Snackbar'
import { Button } from '@/components/ui/button'
import { useDeck, useSettings } from '@/db/hooks'
import type { StudyCard } from '@/db/studySession'
import { answerRatings } from '@/domain/rating'
import type { QueueItem } from '@/domain/session'
import type { SessionProgress } from '@/domain/studySession'
import type { AnswerMode, ListeningAnswer, Rating, StudyMode } from '@/domain/types'
import { unlockAudio } from '@/lib/audio/playCard'
import { languageName } from '@/lib/intl'
import { unlock } from '@/lib/speech/speech'
import { useSpeech } from '@/lib/speech/useSpeech'
import { cn } from '@/lib/utils'
import { ChoiceExercise } from './modes/ChoiceExercise'
import type { ExerciseProps } from './modes/exercise'
import { ListeningExercise } from './modes/ListeningExercise'
import { TypingExercise } from './modes/TypingExercise'
import { FrontFace, promptOf, SwipeCard, type SwipeCardHandle } from './SwipeCard'
import { stackLayer, useStudyMotion } from './studyAnimations'
import { useStudySession } from './useStudySession'

/**
 * S-11 Study session: start gate, top bar and the exercise of the chosen mode (`?mode=`): Mode A swipe cards with
 * answer buttons (the default), Mode B multiple choice, Mode C listening or Mode D typing.
 */
export function StudyPage() {
  const { t } = useTranslation()
  const search = useSearch({ from: '/study' })
  const navigate = useNavigate()
  const router = useRouter()
  const snackbar = useSnackbar()
  const settings = useSettings()
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const card = useRef<SwipeCardHandle>(null)
  const { enter } = useStudyMotion()

  const params = useMemo(
    () => ({ deck: search.deck ?? null, practice: search.practice === 1, repeat: search.repeat ?? null }),
    [search.deck, search.practice, search.repeat],
  )
  const onFinish = useCallback(
    (session: string) => navigate({ to: '/study/summary', search: { session }, replace: true }),
    [navigate],
  )
  const onUndoFailed = useCallback(() => snackbar.show({ message: t('study.undoFailed') }), [snackbar, t])
  const session = useStudySession(params, { onFinish, onUndoFailed })

  async function undo() {
    const restored = await session.undo()
    const study = restored && session.cards?.get(restored.card_id)
    if (restored && study) setAnnouncement(t('a11y.undone', { text: promptOf(study, restored.direction) }))
  }

  async function leave() {
    await session.leave()
    if (router.history.canGoBack()) router.history.back()
    else navigate({ to: '/' })
  }

  const closeButton = (
    <Button
      variant="ghost"
      size="icon-xl"
      aria-label={t('study.close')}
      onClick={() => ((session.progress?.done ?? 0) > 0 ? setConfirmLeave(true) : void leave())}
    >
      <X className="size-6" />
    </Button>
  )

  const [current, ...behind] = session.upcoming
  const currentCard = current && session.cards?.get(current.card_id)
  const mode = search.mode ?? 'swipe'

  return (
    <div className="mx-auto flex h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-[480px] flex-col overflow-hidden">
      {session.phase === 'missing_deck' && (
        <>
          <header className="flex px-2 pt-2">{closeButton}</header>
          <EmptyState
            message={t('study.missingDeck')}
            actionLabel={t('study.goToDecks')}
            onAction={() => navigate({ to: '/decks' })}
          />
        </>
      )}
      {session.phase === 'empty' && (
        <>
          <header className="flex px-2 pt-2">{closeButton}</header>
          <EmptyState
            message={t(params.practice ? 'study.practiceEmpty' : 'study.empty')}
            actionLabel={t('study.backToToday')}
            onAction={() => navigate({ to: '/' })}
          />
        </>
      )}
      {session.phase === 'gate' && session.progress && (
        <>
          <header className="flex px-2 pt-2">{closeButton}</header>
          <StartGate
            deck={params.deck}
            practice={params.practice}
            cards={session.progress.total - session.progress.done}
            resumed={session.resumed}
            languages={[...new Set([...(session.cards?.values() ?? [])].map(({ deck }) => deck.target_lang))]}
            onStart={() => {
              // Synchronously inside the tap: iOS allows speech only after a gesture-started utterance.
              unlock()
              unlockAudio()
              void session.start()
            }}
          />
        </>
      )}
      {session.phase === 'studying' && session.progress && (
        <>
          <TopBar closeButton={closeButton} progress={session.progress} canUndo={session.canUndo} onUndo={undo} />
          {mode !== 'swipe' ? (
            <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
              {current && currentCard && (
                <Exercise
                  mode={mode}
                  study={currentCard}
                  direction={current.direction}
                  itemKey={`${current.card_id}:${current.direction}:${session.turn}`}
                  autoplay={settings.autoplay}
                  listeningAnswer={settings.listening_answer}
                  onAnswer={(rating, options) => void session.answer(rating, options)}
                />
              )}
            </div>
          ) : (
            <>
              <div className="relative flex-1 px-4 py-4">
                <div className="relative size-full">
                  {behind
                    .map((item, index) => ({ item, depth: index + 1 }))
                    .reverse()
                    .map(({ item, depth }) => (
                      <StackCard key={depth} depth={depth} item={item} study={session.cards?.get(item.card_id)} />
                    ))}
                  {current && currentCard && (
                    <motion.div
                      key={`${current.card_id}:${current.direction}:${session.progress.done}`}
                      initial={enter.initial}
                      animate={enter.animate}
                      transition={enter.transition}
                      className="absolute inset-0 origin-bottom"
                    >
                      <SwipeCard
                        ref={card}
                        study={currentCard}
                        direction={current.direction}
                        mode={settings.answer_mode}
                        showIpa={settings.show_ipa_on_front}
                        autoplay={settings.autoplay}
                        onAnswer={(rating) => void session.answer(rating)}
                      />
                    </motion.div>
                  )}
                </div>
              </div>
              <AnswerButtons
                mode={settings.answer_mode}
                disabled={!currentCard}
                onAnswer={(rating) => card.current?.commit(rating)}
              />
            </>
          )}
        </>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <ConfirmSheet
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={t('study.leaveTitle')}
        description={t('study.leaveHint')}
        confirmLabel={t('study.leave')}
        onConfirm={() => void leave()}
      />
    </div>
  )
}

/** The exercise of Modes B–D (S-11) for the current card. */
function Exercise({
  mode,
  listeningAnswer,
  ...props
}: ExerciseProps & { mode: Exclude<StudyMode, 'swipe'>; listeningAnswer: ListeningAnswer }) {
  if (mode === 'choice') return <ChoiceExercise {...props} />
  if (mode === 'listening') return <ListeningExercise {...props} listeningAnswer={listeningAnswer} />
  return <TypingExercise {...props} />
}

type StartGateProps = {
  deck: string | null
  practice: boolean
  cards: number
  resumed: boolean
  /** Studied languages of the session's cards, for the missing-voice warning. */
  languages: string[]
  onStart: () => void
}

/** The first screen of a session; its tap also unlocks speech synthesis on iOS (P1-T11). */
function StartGate({ deck: deckId, practice, cards, resumed, languages, onStart }: StartGateProps) {
  const { t, i18n } = useTranslation()
  const deck = useDeck(deckId ?? '')
  const { hasVoice } = useSpeech()
  const deckName = deckId ? deck?.name : t('study.allDecks')
  // `hasVoice` is null while voices load: warn only once the list is known.
  const silent = languages.filter((lang) => hasVoice(lang) === false)
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-12 text-center">
      <h1 className="text-2xl font-semibold">{deckName}</h1>
      {practice && <p className="text-lg">{t('study.practice')}</p>}
      <p className="text-muted-foreground">{t('cards.count', { count: cards })}</p>
      {resumed && <p className="text-muted-foreground">{t('study.resumed')}</p>}
      <Button size="xl" className="mt-4 w-full max-w-xs" onClick={onStart}>
        {t(resumed ? 'study.continue' : 'study.start')}
      </Button>
      {silent.map((lang) => (
        <Link
          key={lang}
          to="/settings/voices"
          role="alert"
          className="flex w-full max-w-xs items-start gap-2 rounded-xl bg-secondary p-3 text-left text-sm"
        >
          <VolumeX className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('speech.noVoice', { language: languageName(lang.split('-')[0] ?? lang, i18n.language) })}
        </Link>
      ))}
    </div>
  )
}

type TopBarProps = { closeButton: ReactNode; progress: SessionProgress; canUndo: boolean; onUndo: () => void }

function TopBar({ closeButton, progress, canUndo, onUndo }: TopBarProps) {
  const { t } = useTranslation()
  const { done, total, counts } = progress
  const text = t('study.progress', { done, total })
  return (
    <header className="flex items-center gap-2 px-2 pt-2">
      {closeButton}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div
          role="progressbar"
          aria-label={t('study.progressLabel')}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-valuetext={text}
          className="h-2 overflow-hidden rounded-full bg-secondary"
        >
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
        <p className="flex justify-between gap-2 text-xs text-muted-foreground tabular-nums">
          <span className="truncate">
            {t('study.counts.new', { count: counts.new })} · {t('study.counts.learning', { count: counts.learning })} ·{' '}
            {t('study.counts.review', { count: counts.review })}
          </span>
          <span data-testid="study-progress" className="shrink-0 whitespace-nowrap">
            {text}
          </span>
        </p>
      </div>
      <Button variant="ghost" size="icon-xl" aria-label={t('study.undo')} disabled={!canUndo} onClick={onUndo}>
        <Undo2 className="size-6" />
      </Button>
    </header>
  )
}

/** A card waiting behind the current one: front only, smaller and lower (the stack preview). */
function StackCard({ depth, item, study }: { depth: number; item: QueueItem; study: StudyCard | undefined }) {
  const { scale, y } = stackLayer(depth)
  return (
    <div
      aria-hidden
      className="absolute inset-0 flex origin-bottom flex-col rounded-3xl border bg-card p-6 text-center text-card-foreground shadow-md"
      style={{ transform: `translateY(${y}px) scale(${scale})` }}
    >
      {study && <FrontFace study={study} direction={item.direction} showIpa={false} />}
    </div>
  )
}

const buttonStyle: Record<Rating, string> = {
  1: 'bg-again hover:bg-again/90',
  2: 'bg-hard hover:bg-hard/90',
  3: 'bg-good hover:bg-good/90',
  4: 'bg-easy hover:bg-easy/90',
}

/** Buttons under the card, the accessible alternative to swiping: ✗ / ✓, or Again · Hard · Good · Easy. */
function AnswerButtons({
  mode,
  disabled,
  onAnswer,
}: {
  mode: AnswerMode
  disabled: boolean
  onAnswer: (rating: Rating) => void
}) {
  const { t } = useTranslation()
  const label = (rating: Rating) =>
    mode === 'simple' ? t(rating === 1 ? 'study.dontKnow' : 'study.know') : t(`study.ratings.${rating}`)
  return (
    <div className={cn('grid gap-3 px-4 pb-4', mode === 'simple' ? 'grid-cols-2' : 'grid-cols-4 gap-2')}>
      {answerRatings(mode).map((rating) => (
        <Button
          key={rating}
          size="xl"
          disabled={disabled}
          onClick={() => onAnswer(rating)}
          className={cn('text-white', buttonStyle[rating], mode === 'detailed' && 'px-1')}
        >
          {mode === 'simple' && (rating === 1 ? <X className="size-5" /> : <Check className="size-5" />)}
          {label(rating)}
        </Button>
      ))}
    </div>
  )
}
