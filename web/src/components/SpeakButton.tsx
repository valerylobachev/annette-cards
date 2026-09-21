import { Volume2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useSpeech } from '@/lib/speech/useSpeech'
import { cn } from '@/lib/utils'

type Props = {
  text: string
  /** BCP-47 language of `text` (the deck's `target_lang`). */
  lang: string
  /** The card's server clip (`card.audio_id`), played instead of the system voice. */
  audioId?: string | null
  className?: string
}

/** Speaker button that pronounces `text` (UC-12), with the card's server audio when it has one; it does not trigger the row or card it sits in. */
export function SpeakButton({ text, lang, audioId = null, className }: Props) {
  const { t } = useTranslation()
  const { pronounce } = useSpeech()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xl"
      aria-label={t('speech.speak', { text })}
      disabled={text.trim() === ''}
      className={cn('shrink-0 text-muted-foreground', className)}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void pronounce(text, lang, audioId)
      }}
    >
      <Volume2 className="size-5" />
    </Button>
  )
}
