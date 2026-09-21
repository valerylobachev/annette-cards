import { animate, type MotionValue, motion, type PanInfo, useMotionValue, useTransform } from 'motion/react'
import { type ReactNode, type Ref, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FitText } from '@/components/FitText'
import type { StudyCard } from '@/db/studySession'
import { type SwipeDirection, swipeOutcome, swipeRating } from '@/domain/rating'
import type { AnswerMode, Direction, Rating } from '@/domain/types'
import { cn } from '@/lib/utils'
import { FLY_DISTANCE, flipTransition, flyOut, MAX_TILT_DEG, springBack } from './studyAnimations'

export type SwipeCardHandle = {
  /** Flies the card out as if swiped, then answers (the buttons under the card use this). */
  commit: (rating: Rating) => void
}

type Props = {
  study: StudyCard
  direction: Direction
  mode: AnswerMode
  showIpa: boolean
  onAnswer: (rating: Rating) => void
  ref?: Ref<SwipeCardHandle>
}

const flyDirection = (rating: Rating): SwipeDirection => (rating === 1 ? 'left' : rating === 4 ? 'up' : 'right')
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Mode A swipe card (ui_ux.md S-11): tap flips, drag right = Good, left = Again, up = Easy (detailed mode). The
 * card tilts and shows a labelled overlay while dragged; a drag below the threshold springs back.
 */
export function SwipeCard({ study, direction, mode, showIpa, onAnswer, ref }: Props) {
  const area = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)
  const committed = useRef(false)
  const [flipped, setFlipped] = useState(false)
  const turn = useMotionValue(0)
  // The face turned away is hidden by the angle, not by `backface-visibility`, which WebKit does not honour here.
  const frontOpacity = useTransform(turn, (deg): number => (deg < 90 ? 1 : 0))
  const backOpacity = useTransform(turn, (deg): number => (deg < 90 ? 0 : 1))
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const width = () => area.current?.offsetWidth || 1
  const height = () => area.current?.offsetHeight || 1
  const rotate = useTransform(x, (v) => clamp((v / width()) * MAX_TILT_DEG, -MAX_TILT_DEG, MAX_TILT_DEG))
  const knowOpacity = useTransform(x, (v) => clamp(v / (width() * 0.35), 0, 1))
  const againOpacity = useTransform(x, (v) => clamp(-v / (width() * 0.35), 0, 1))
  const easyOpacity = useTransform(y, (v) => (mode === 'detailed' ? clamp(-v / (height() * 0.3), 0, 1) : 0))

  async function commit(towards: SwipeDirection, rating: Rating) {
    if (committed.current) return
    committed.current = true
    const flight =
      towards === 'up'
        ? [animate(y, -height() * FLY_DISTANCE, flyOut)]
        : [animate(x, (towards === 'right' ? 1 : -1) * width() * FLY_DISTANCE, flyOut)]
    await Promise.all(flight)
    onAnswer(rating)
  }

  useImperativeHandle(ref, () => ({ commit: (rating) => void commit(flyDirection(rating), rating) }))

  function flip(toBack: boolean) {
    if (dragged.current) return
    setFlipped(toBack)
    animate(turn, toBack ? 180 : 0, flipTransition)
  }

  function onDragEnd(_event: unknown, info: PanInfo) {
    const towards = swipeOutcome(info.offset, info.velocity, { width: width(), height: height() }, mode)
    const rating = towards && swipeRating(towards, mode)
    if (towards && rating) {
      void commit(towards, rating)
    } else {
      animate(x, 0, springBack)
      animate(y, 0, springBack)
    }
  }

  return (
    <div ref={area} className="absolute inset-0">
      <motion.div
        data-testid="swipe-card"
        drag={mode === 'detailed' ? true : 'x'}
        dragMomentum={false}
        style={{ x, y, rotate }}
        onPointerDown={() => {
          dragged.current = false
        }}
        onDragStart={() => {
          dragged.current = true
        }}
        onDragEnd={onDragEnd}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
      >
        <div className="absolute inset-0 perspective-[1000px]">
          <motion.div style={{ rotateY: turn }} className="relative size-full transform-3d">
            <CardSide hint="study.tapToFlip" hidden={flipped} opacity={frontOpacity} onTap={() => flip(true)}>
              <FrontFace study={study} direction={direction} showIpa={showIpa} />
            </CardSide>
            <CardSide back hint="study.tapToFlipBack" hidden={!flipped} opacity={backOpacity} onTap={() => flip(false)}>
              <BackFace study={study} direction={direction} />
            </CardSide>
          </motion.div>
        </div>
        <SwipeOverlay label="study.know" className="bg-good/85" opacity={knowOpacity} />
        <SwipeOverlay label="study.ratings.1" className="bg-again/85" opacity={againOpacity} />
        <SwipeOverlay label="study.ratings.4" className="bg-easy/85" opacity={easyOpacity} />
      </motion.div>
    </div>
  )
}

type CardSideProps = {
  back?: boolean
  hidden: boolean
  hint: 'study.tapToFlip' | 'study.tapToFlipBack'
  opacity: MotionValue<number>
  onTap: () => void
  children: ReactNode
}

function CardSide({ back = false, hidden, hint, opacity, onTap, children }: CardSideProps) {
  const { t } = useTranslation()
  return (
    <motion.button
      type="button"
      style={{ opacity }}
      aria-hidden={hidden}
      tabIndex={hidden ? -1 : 0}
      onClick={onTap}
      className={cn(
        'absolute inset-0 flex flex-col rounded-3xl border bg-card p-6 text-center text-card-foreground shadow-lg',
        back && 'rotate-y-180',
        hidden && 'pointer-events-none',
      )}
    >
      {children}
      <span className="sr-only">{t(hint)}</span>
    </motion.button>
  )
}

/** The prompt: the studied word (+ IPA) for forward, the translation for reverse. */
export function FrontFace({ study, direction, showIpa }: { study: StudyCard; direction: Direction; showIpa: boolean }) {
  const { card, deck } = study
  const forward = direction === 'forward'
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
      <FitText
        text={forward ? card.front : card.back}
        lang={forward ? deck.target_lang : deck.native_lang}
        max={40}
        className="font-semibold"
      />
      {forward && showIpa && card.ipa && <p className="text-lg text-muted-foreground">/{card.ipa}/</p>}
    </div>
  )
}

/** The answer side: prompt small on top, the answer large, then example and notes; scrolls when long. */
function BackFace({ study, direction }: { study: StudyCard; direction: Direction }) {
  const { card, deck } = study
  const forward = direction === 'forward'
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto">
      <p lang={forward ? deck.target_lang : deck.native_lang} className="text-lg text-muted-foreground">
        {forward ? card.front : card.back}
      </p>
      <FitText
        text={forward ? card.back : card.front}
        lang={forward ? deck.native_lang : deck.target_lang}
        max={32}
        className="font-semibold"
      />
      {!forward && card.ipa && <p className="text-lg text-muted-foreground">/{card.ipa}/</p>}
      {card.example && (
        <div className="flex flex-col gap-1 text-base">
          <p lang={deck.target_lang} className="italic">
            {card.example}
          </p>
          {card.example_translation && (
            <p lang={deck.native_lang} className="text-muted-foreground">
              {card.example_translation}
            </p>
          )}
        </div>
      )}
      {card.notes && <p className="text-sm whitespace-pre-line text-muted-foreground">{card.notes}</p>}
    </div>
  )
}

function SwipeOverlay({
  label,
  className,
  opacity,
}: {
  label: 'study.know' | 'study.ratings.1' | 'study.ratings.4'
  className: string
  opacity: MotionValue<number>
}) {
  const { t } = useTranslation()
  return (
    <motion.div
      aria-hidden
      style={{ opacity }}
      className={cn(
        'pointer-events-none absolute inset-0 flex items-center justify-center rounded-3xl text-3xl font-bold text-white',
        className,
      )}
    >
      {t(label)}
    </motion.div>
  )
}
