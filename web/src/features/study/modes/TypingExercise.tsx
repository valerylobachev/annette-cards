import { useCallback } from 'react'
import { FitText } from '@/components/FitText'
import { answerLang, expectedAnswers } from '@/domain/answer'
import { shouldSpeak } from '@/lib/speech/speech'
import { useSpeech } from '@/lib/speech/useSpeech'
import { ExerciseCard, type ExerciseProps, SpeakerButton, useOncePerItem } from './exercise'
import { TypedAnswer } from './TypedAnswer'

/** S-11 Mode D: type the answer to the prompt; exact → Good, near miss → Hard, wrong or "I don't know" → Again. */
export function TypingExercise({ study, direction, itemKey, autoplay, onAnswer }: ExerciseProps) {
  const { card, deck } = study
  const forward = direction === 'forward'
  const { speaker } = useSpeech()
  const pronounce = useCallback(() => void speaker.play(card, deck.target_lang, 'front'), [speaker, card, deck])
  useOncePerItem(itemKey, shouldSpeak(autoplay, direction, 'front'), pronounce)

  return (
    <TypedAnswer
      itemKey={itemKey}
      expected={expectedAnswers(card, direction)}
      lang={answerLang(deck, direction)}
      correctAnswer={forward ? card.back : card.front}
      prompt={(revealed) => (
        <ExerciseCard>
          <FitText
            text={forward ? card.front : card.back}
            lang={forward ? deck.target_lang : deck.native_lang}
            max={40}
            className="font-semibold"
          />
          {(forward || revealed) && <SpeakerButton text={card.front} onSpeak={pronounce} />}
        </ExerciseCard>
      )}
      onReveal={(verdict) => {
        // The studied word is spoken with a wrong answer (the correct answer in reverse, the prompt in forward).
        if (verdict === 'wrong' || shouldSpeak(autoplay, direction, 'back')) pronounce()
      }}
      onAnswer={(rating, answeredAt) => onAnswer(rating, { mode: 'typing', answeredAt })}
    />
  )
}
