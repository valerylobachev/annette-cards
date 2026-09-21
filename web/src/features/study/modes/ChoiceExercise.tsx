import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect } from 'react'
import { listDistractorPool } from '@/db/cards'
import type { StudyCard } from '@/db/studySession'
import { type ChoiceOption, choiceOptions } from '@/domain/distractors'
import { shouldSpeak } from '@/lib/speech/speech'
import { useSpeech } from '@/lib/speech/useSpeech'
import { BackFace, FrontFace } from '../SwipeCard'
import { ChoiceAnswer } from './ChoiceAnswer'
import { ExerciseCard, type ExerciseProps, SpeakerButton, useItemState, useOncePerItem } from './exercise'
import { TypingExercise } from './TypingExercise'

/**
 * The options of one question, picked once per card (`itemKey`) from the distractor pool of the card's deck and
 * language, so a change in the database does not reshuffle them mid-question. `undefined` while loading.
 */
export function useChoiceOptions(
  { card, deck }: StudyCard,
  itemKey: string,
  field: 'front' | 'back',
): ChoiceOption[] | undefined {
  const loaded = useLiveQuery(
    async () => ({ deckId: deck.id, pool: await listDistractorPool(deck.id, deck.target_lang) }),
    [deck.id, deck.target_lang],
  )
  const pool = loaded?.deckId === deck.id ? loaded.pool : undefined
  const [options, setOptions] = useItemState<ChoiceOption[] | undefined>(itemKey, undefined)
  useEffect(() => {
    if (pool && !options) setOptions(choiceOptions(card, pool, field))
  }, [pool, options, setOptions, card, field])
  return options
}

/**
 * S-11 Mode B: the prompt (studied word for forward, translation for reverse) and four written answers. A card
 * without any other word in its language to offer is asked by typing instead.
 */
export function ChoiceExercise(props: ExerciseProps) {
  const { study, direction, itemKey, autoplay, onAnswer } = props
  const { card, deck } = study
  const forward = direction === 'forward'
  const options = useChoiceOptions(study, itemKey, forward ? 'back' : 'front')
  const { speaker } = useSpeech()
  const pronounce = useCallback(() => void speaker.play(card, deck.target_lang, 'front'), [speaker, card, deck])
  const autoplayFront = shouldSpeak(autoplay, direction, 'front')
  useOncePerItem(itemKey, autoplayFront && options !== undefined && options.length > 1, pronounce)

  if (!options) return null
  if (options.length < 2) return <TypingExercise {...props} />
  return (
    <ChoiceAnswer
      itemKey={itemKey}
      options={options}
      lang={forward ? deck.native_lang : deck.target_lang}
      prompt={(result) => (
        <ExerciseCard className={result === 'wrong' ? 'justify-start' : undefined}>
          {result === 'wrong' ? (
            <BackFace study={study} direction={direction} />
          ) : (
            <FrontFace study={study} direction={direction} showIpa={false} />
          )}
          {(forward || result !== null) && <SpeakerButton text={card.front} onSpeak={pronounce} />}
        </ExerciseCard>
      )}
      onReveal={(correct) => {
        if (!correct || shouldSpeak(autoplay, direction, 'back')) pronounce()
      }}
      onAnswer={(rating, answeredAt) => onAnswer(rating, { mode: 'choice', answeredAt })}
    />
  )
}
