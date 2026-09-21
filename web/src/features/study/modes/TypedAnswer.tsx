import { Check, X } from 'lucide-react'
import { type FormEvent, type ReactNode, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { checkTypedAnswer, type DiffSegment, type TypedResult, type TypedVerdict } from '@/domain/answer'
import { typedRating } from '@/domain/rating'
import { now } from '@/lib/clock'
import { cn } from '@/lib/utils'
import { type Answer, useAnswerOnce, useAutoAdvance, useItemState } from './exercise'

type Props = {
  itemKey: string
  /** Accepted answers; any one matches. */
  expected: string[]
  /** Language the answer is typed in. */
  lang: string
  /** Shown after a wrong answer. */
  correctAnswer: string
  /** The card area; `revealed` once the answer was checked. */
  prompt: (revealed: boolean) => ReactNode
  /** Called when the verdict is shown (to speak the word). */
  onReveal: (verdict: TypedVerdict) => void
  onAnswer: Answer
}

type Checked = { result: TypedResult; at: number }

/**
 * A typed answer (S-11 Mode D, listening by typing): Check or Enter, then exact → Good and the next card after
 * `ADVANCE_MS`, near miss → Hard with a diff, wrong or "I don't know" → Again with the correct answer; Continue or
 * Enter moves on.
 */
export function TypedAnswer({ itemKey, expected, lang, correctAnswer, prompt, onReveal, onAnswer }: Props) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useItemState(itemKey, '')
  const [checked, setChecked] = useItemState<Checked | null>(itemKey, null)
  const answer = useAnswerOnce(itemKey, onAnswer)
  const verdict = checked?.result.verdict
  useAutoAdvance(answer, checked && verdict === 'exact' ? { rating: 3, answeredAt: checked.at } : null)

  function reveal(result: TypedResult) {
    setChecked({ result, at: now() })
    onReveal(result.verdict)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    // Called inside the key press or tap, so iOS keeps the keyboard for the next card.
    input.current?.focus()
    if (checked) answer(typedRating(checked.result.verdict), checked.at)
    else if (value.trim() !== '') reveal(checkTypedAnswer(expected, value, lang))
  }

  return (
    <div className="flex size-full flex-col gap-4">
      {prompt(checked !== null)}

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
