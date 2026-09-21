import { Volume2 } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { StudyCard } from '@/db/studySession'
import type { Autoplay, Direction, Rating } from '@/domain/types'
import { cn } from '@/lib/utils'
import type { AnswerOptions } from '../useStudySession'

/** A correct answer moves on by itself after this delay (ui_ux.md S-11 Modes B–D). */
export const ADVANCE_MS = 600

/** Props of every exercise on the study screen (S-11 Modes B–D). */
export type ExerciseProps = {
  study: StudyCard
  direction: Direction
  /**
   * Changes with every card shown. An exercise resets for a new key but stays mounted, so a text field keeps the
   * focus and iOS keeps the keyboard open between cards.
   */
  itemKey: string
  autoplay: Autoplay
  onAnswer: (rating: Rating, options: AnswerOptions) => void
}

/** Records the answer of an exercise: the rating and when it was given (Check or the tapped option). */
export type Answer = (rating: Rating, answeredAt: number) => void

/** State that starts over from `initial` for every new card (`itemKey`). */
export function useItemState<T>(itemKey: string, initial: T): [T, (value: T) => void] {
  const [state, setState] = useState({ key: itemKey, value: initial })
  const set = useCallback((value: T) => setState({ key: itemKey, value }), [itemKey])
  return [state.key === itemKey ? state.value : initial, set]
}

/** Runs `run` once per card while `enabled`, even when React runs the effect twice (StrictMode). */
export function useOncePerItem(itemKey: string, enabled: boolean, run: () => void) {
  const done = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled || done.current === itemKey) return
    done.current = itemKey
    run()
  }, [itemKey, enabled, run])
}

/**
 * `answer` passes the first answer of a card to `onAnswer`; a second one (Enter after the auto-advance, a double
 * tap) is ignored. It is stable for one card, while `onAnswer` may change on every render.
 */
export function useAnswerOnce(itemKey: string, onAnswer: Answer): Answer {
  const answered = useRef<string | null>(null)
  const latest = useRef(onAnswer)
  useEffect(() => {
    latest.current = onAnswer
  })
  return useCallback<Answer>(
    (rating, answeredAt) => {
      if (answered.current === itemKey) return
      answered.current = itemKey
      latest.current(rating, answeredAt)
    },
    [itemKey],
  )
}

/** Gives a correct answer (`rating` at `answeredAt`) by itself after `ADVANCE_MS`; `null` waits for Continue. */
export function useAutoAdvance(answer: Answer, correct: { rating: Rating; answeredAt: number } | null) {
  const rating = correct?.rating
  const answeredAt = correct?.answeredAt
  useEffect(() => {
    if (rating === undefined || answeredAt === undefined) return
    const timer = setTimeout(() => answer(rating, answeredAt), ADVANCE_MS)
    return () => clearTimeout(timer)
  }, [answer, rating, answeredAt])
}

/** The card area above the answer controls. */
export function ExerciseCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-3xl border bg-card p-6 text-center text-card-foreground shadow-lg',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Speaker in the card corner: plays the studied word. */
export function SpeakerButton({ text, onSpeak }: { text: string; onSpeak: () => void }) {
  const { t } = useTranslation()
  return (
    <Button
      variant="ghost"
      size="icon-xl"
      aria-label={t('speech.speak', { text })}
      onClick={onSpeak}
      className="absolute top-2 right-2 text-muted-foreground"
    >
      <Volume2 className="size-6" />
    </Button>
  )
}
