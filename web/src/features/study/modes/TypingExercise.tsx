import { Check, Volume2, X } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FitText } from '@/components/FitText'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { StudyCard } from '@/db/studySession'
import { answerLang, checkTypedAnswer, type DiffSegment, expectedAnswers, type TypedResult } from '@/domain/answer'
import { typedRating } from '@/domain/rating'
import type { Autoplay, Direction, Rating } from '@/domain/types'
import { now } from '@/lib/clock'
import { shouldSpeak } from '@/lib/speech/speech'
import { useSpeech } from '@/lib/speech/useSpeech'
import { cn } from '@/lib/utils'

/** An exact answer moves on by itself after this delay (ui_ux.md S-11 Mode D). */
export const TYPING_ADVANCE_MS = 600

type Props = {
  study: StudyCard
  direction: Direction
  /**
   * Changes with every card shown. The exercise resets for a new key but stays mounted, so the input keeps the
   * focus and iOS keeps the keyboard open between cards.
   */
  itemKey: string
  autoplay: Autoplay
  /** `answeredAt`: when the answer was checked, so time spent reading the result is not counted. */
  onAnswer: (rating: Rating, answeredAt: number) => void
}

type Checked = { result: TypedResult; at: number }

/** S-11 Mode D: type the answer to the prompt; exact → Good, near miss → Hard, wrong or "I don't know" → Again. */
export function TypingExercise({ study, direction, itemKey, autoplay, onAnswer }: Props) {
  const { t } = useTranslation()
  const { card, deck } = study
  const input = useRef<HTMLInputElement>(null)
  // The card already answered: Enter and the auto-advance timer must not answer it twice.
  const answered = useRef<string | null>(null)
  const [shown, setShown] = useState(itemKey)
  const [value, setValue] = useState('')
  const [checked, setChecked] = useState<Checked | null>(null)
  if (shown !== itemKey) {
    setShown(itemKey)
    setValue('')
    setChecked(null)
  }

  const { speaker } = useSpeech()
  const pronounce = useCallback(() => void speaker.play(card, deck.target_lang, 'front'), [speaker, card, deck])
  // The prompt is spoken once per card, even when React runs the effect twice (StrictMode).
  const spoken = useRef<string | null>(null)
  useEffect(() => {
    if (spoken.current === itemKey || !shouldSpeak(autoplay, direction, 'front')) return
    spoken.current = itemKey
    pronounce()
  }, [itemKey, autoplay, direction, pronounce])

  const next = useCallback(() => {
    if (!checked || answered.current === itemKey) return
    answered.current = itemKey
    onAnswer(typedRating(checked.result.verdict), checked.at)
  }, [checked, itemKey, onAnswer])

  useEffect(() => {
    if (checked?.result.verdict !== 'exact') return
    const timer = setTimeout(next, TYPING_ADVANCE_MS)
    return () => clearTimeout(timer)
  }, [checked, next])

  function reveal(result: TypedResult) {
    setChecked({ result, at: now() })
    // The studied word is spoken with a wrong answer (the correct answer in reverse, the prompt in forward).
    if (result.verdict === 'wrong' || shouldSpeak(autoplay, direction, 'back')) pronounce()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    // Called inside the key press or tap, so iOS keeps the keyboard for the next card.
    input.current?.focus()
    if (checked) next()
    else if (value.trim() !== '')
      reveal(checkTypedAnswer(expectedAnswers(card, direction), value, answerLang(deck, direction)))
  }

  const forward = direction === 'forward'
  const lang = answerLang(deck, direction)
  const correctAnswer = forward ? card.back : card.front
  const verdict = checked?.result.verdict

  return (
    <div className="flex size-full flex-col gap-4">
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-3xl border bg-card p-6 text-center text-card-foreground shadow-lg">
        <FitText
          text={forward ? card.front : card.back}
          lang={forward ? deck.target_lang : deck.native_lang}
          max={40}
          className="font-semibold"
        />
        {(forward || checked) && (
          <Button
            variant="ghost"
            size="icon-xl"
            aria-label={t('speech.speak', { text: card.front })}
            onClick={pronounce}
            className="absolute top-2 right-2 text-muted-foreground"
          >
            <Volume2 className="size-6" />
          </Button>
        )}
      </div>

      <div aria-live="polite" className="flex min-h-24 flex-col items-center justify-center gap-1 text-center">
        {checked && verdict === 'exact' && (
          <p className="flex items-center gap-2 text-xl font-semibold text-good">
            <Check className="size-6" aria-hidden />
            {t('study.typing.correct')}
          </p>
        )}
        {checked && verdict === 'near' && (
          <>
            <p className="text-lg font-semibold text-hard">{t('study.typing.almost')}</p>
            <AnswerDiff diff={checked.result.diff} lang={lang} />
            <p className="sr-only">
              {t('study.typing.correctAnswer')} <span lang={lang}>{checked.result.matched}</span>
            </p>
          </>
        )}
        {checked && verdict === 'wrong' && (
          <>
            <p className="flex items-center gap-2 text-lg text-again">
              <X className="size-6 shrink-0" aria-hidden />
              {t('study.typing.correctAnswer')}
            </p>
            <p lang={lang} data-testid="typing-correct-answer" className="text-2xl font-semibold">
              {correctAnswer}
            </p>
          </>
        )}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input
          ref={input}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          readOnly={checked !== null}
          lang={lang}
          aria-label={t('study.typing.answerLabel')}
          placeholder={t('study.typing.placeholder')}
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={checked ? 'next' : 'done'}
          className={cn(
            'h-14 text-center text-xl md:text-xl',
            verdict === 'exact' && 'border-good ring-2 ring-good/40',
            verdict === 'near' && 'border-hard ring-2 ring-hard/40',
            verdict === 'wrong' && 'border-again ring-2 ring-again/40',
          )}
        />
        {checked && verdict !== 'exact' ? (
          <Button type="submit" size="xl">
            {t('study.typing.continue')}
          </Button>
        ) : (
          <Button type="submit" size="xl" disabled={checked !== null || value.trim() === ''}>
            {t('study.typing.check')}
          </Button>
        )}
        <Button
          type="button"
          variant="link"
          disabled={checked !== null}
          onClick={() => {
            input.current?.focus()
            reveal({ verdict: 'wrong', matched: null, diff: [] })
          }}
        >
          {t('study.typing.dontKnow')}
        </Button>
      </form>
    </div>
  )
}

const diffStyle: Record<DiffSegment['kind'], string> = {
  same: '',
  missing: 'text-good underline decoration-2 underline-offset-4',
  extra: 'text-again line-through',
  diacritic: 'text-hard underline decoration-2 underline-offset-4',
}

/** The near-miss correction: missing letters and diacritics underlined, extra letters struck through. */
function AnswerDiff({ diff, lang }: { diff: DiffSegment[]; lang: string }) {
  return (
    <p aria-hidden lang={lang} data-testid="typing-diff" className="text-2xl font-semibold whitespace-pre-wrap">
      {diff.map((segment, index) => (
        // Segments never reorder, so their position is a stable key.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <span key={index} data-kind={segment.kind} className={diffStyle[segment.kind]}>
          {segment.text}
        </span>
      ))}
    </p>
  )
}
