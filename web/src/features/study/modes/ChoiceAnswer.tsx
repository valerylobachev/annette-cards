import { Check, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { ChoiceOption } from '@/domain/distractors'
import { now } from '@/lib/clock'
import { cn } from '@/lib/utils'
import { type Answer, useAnswerOnce, useAutoAdvance, useItemState } from './exercise'

export type ChoiceResult = 'correct' | 'wrong' | null

type Props = {
  itemKey: string
  options: ChoiceOption[]
  /** Language of the options. */
  lang: string
  /** The card area; `result` once an option was tapped. */
  prompt: (result: ChoiceResult) => ReactNode
  /** Called when the result is shown (to speak the word). */
  onReveal: (correct: boolean) => void
  onAnswer: Answer
}

/**
 * Written options (S-11 Modes B and C): the correct one → green and the next card after `ADVANCE_MS` (Good); a
 * wrong one → red with the correct one green, then Continue (Again).
 */
export function ChoiceAnswer({ itemKey, options, lang, prompt, onReveal, onAnswer }: Props) {
  const { t } = useTranslation()
  const [picked, setPicked] = useItemState<{ index: number; at: number } | null>(itemKey, null)
  const answer = useAnswerOnce(itemKey, onAnswer)
  const correct = picked !== null && options[picked.index]?.correct === true
  useAutoAdvance(answer, picked && correct ? { rating: 3, answeredAt: picked.at } : null)
  const result: ChoiceResult = picked === null ? null : correct ? 'correct' : 'wrong'
  const answerText = options.find((option) => option.correct)?.text ?? ''

  function pick(index: number) {
    setPicked({ index, at: now() })
    onReveal(options[index]?.correct === true)
  }

  return (
    <div className="flex size-full flex-col gap-4">
      {prompt(result)}
      <p aria-live="polite" className="sr-only">
        {result === 'correct' && t('study.typing.correct')}
        {result === 'wrong' && (
          <>
            {t('study.typing.correctAnswer')} <span lang={lang}>{answerText}</span>
          </>
        )}
      </p>
      <ul aria-label={t('study.choice.options')} className="flex flex-col gap-2">
        {options.map((option, index) => {
          const chosen = picked?.index === index
          const state = picked === null ? null : option.correct ? 'correct' : chosen ? 'wrong' : 'other'
          return (
            <li key={option.text}>
              <Button
                variant="outline"
                size="xl"
                lang={lang}
                disabled={picked !== null}
                aria-pressed={chosen}
                data-state={state ?? undefined}
                onClick={() => pick(index)}
                className={cn(
                  'h-auto min-h-14 w-full py-3 text-lg whitespace-normal disabled:opacity-100',
                  state === 'correct' && 'border-good bg-good text-white',
                  state === 'wrong' && 'border-again bg-again text-white',
                  state === 'other' && 'opacity-60 disabled:opacity-60',
                )}
              >
                {state === 'correct' && <Check className="size-5 shrink-0" aria-hidden />}
                {state === 'wrong' && <X className="size-5 shrink-0" aria-hidden />}
                {option.text}
              </Button>
            </li>
          )
        })}
      </ul>
      {result === 'wrong' && picked && (
        <Button size="xl" autoFocus onClick={() => answer(1, picked.at)}>
          {t('study.typing.continue')}
        </Button>
      )}
    </div>
  )
}
