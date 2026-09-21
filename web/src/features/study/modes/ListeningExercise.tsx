import { Snail, Volume2 } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { ListeningAnswer, Rating } from '@/domain/types'
import { SLOW_RATE } from '@/lib/speech/speech'
import { useSpeech } from '@/lib/speech/useSpeech'
import { BackFace } from '../SwipeCard'
import { ChoiceAnswer } from './ChoiceAnswer'
import { useChoiceOptions } from './ChoiceExercise'
import { ExerciseCard, type ExerciseProps, SpeakerButton, useOncePerItem } from './exercise'
import { TypedAnswer } from './TypedAnswer'

type Props = ExerciseProps & { listeningAnswer: ListeningAnswer }

/**
 * S-11 Mode C: the studied word is played when the card is shown (the start gate unlocked audio on iOS), with
 * replay and "Play slower"; the learner picks or types the written word, whatever the card's direction. Without
 * other words in the language to offer, the answer is typed.
 */
export function ListeningExercise({ study, itemKey, listeningAnswer, onAnswer }: Props) {
  const { t } = useTranslation()
  const { card, deck } = study
  const { speaker } = useSpeech()
  const play = useCallback(() => void speaker.play(card, deck.target_lang, 'front'), [speaker, card, deck])
  const playSlower = () => void speaker.play(card, deck.target_lang, 'front', { rate: SLOW_RATE })
  useOncePerItem(itemKey, true, play)
  const options = useChoiceOptions(study, itemKey, 'front')

  const prompt = (revealed: boolean) => (
    <ExerciseCard className={revealed ? 'justify-start' : undefined}>
      {revealed ? (
        <>
          <BackFace study={study} direction="reverse" />
          <SpeakerButton text={card.front} onSpeak={play} />
        </>
      ) : (
        <>
          <Button
            variant="secondary"
            aria-label={t('study.listening.play')}
            onClick={play}
            className="size-28 rounded-full"
          >
            <Volume2 className="size-12" />
          </Button>
          <Button variant="ghost" size="xl" onClick={playSlower}>
            <Snail className="size-5" aria-hidden />
            {t('study.listening.slower')}
          </Button>
        </>
      )}
    </ExerciseCard>
  )
  const answered = (rating: Rating, answeredAt: number) => onAnswer(rating, { mode: 'listen', answeredAt })

  if (listeningAnswer === 'choose' && !options) return null
  if (listeningAnswer === 'choose' && options && options.length > 1) {
    return (
      <ChoiceAnswer
        itemKey={itemKey}
        options={options}
        lang={deck.target_lang}
        prompt={(result) => prompt(result !== null)}
        onReveal={() => undefined}
        onAnswer={answered}
      />
    )
  }
  return (
    <TypedAnswer
      itemKey={itemKey}
      expected={[card.front]}
      lang={deck.target_lang}
      correctAnswer={card.front}
      prompt={prompt}
      onReveal={(verdict) => {
        if (verdict === 'wrong') play()
      }}
      onAnswer={answered}
    />
  )
}
