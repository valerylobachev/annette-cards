import { useRouter } from '@tanstack/react-router'
import { ChevronLeft, Play } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useDecks } from '@/db/hooks'
import { setMeta } from '@/db/meta'
import { languageName } from '@/lib/intl'
import { sampleText } from '@/lib/speech/samples'
import { speak, speechSupported } from '@/lib/speech/speech'
import { useSpeech } from '@/lib/speech/useSpeech'
import { voiceQuality } from '@/lib/speech/voices'
import { cn } from '@/lib/utils'

/** S-16 Voices: per studied language, the voices of this device with samples; the choice is device-local (UC-22). */
export function VoicesPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const decks = useDecks()
  const languages = [...new Set((decks ?? []).map((deck) => deck.target_lang))].sort()

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pt-2 pb-8">
      <header className="-mx-2 flex min-h-14 items-center gap-1">
        <Button variant="ghost" size="icon-xl" aria-label={t('common.back')} onClick={() => router.history.back()}>
          <ChevronLeft className="size-6" />
        </Button>
        <h1 className="text-2xl font-semibold">{t('screens.voices.title')}</h1>
      </header>
      <p className="text-muted-foreground">{t('voices.deviceOnly')}</p>
      {!speechSupported() && <p role="alert">{t('voices.unsupported')}</p>}
      {decks && languages.length === 0 && <p>{t('voices.noLanguages')}</p>}
      {languages.map((lang) => (
        <LanguageVoices key={lang} lang={lang} />
      ))}
      <section className="flex flex-col gap-2 rounded-2xl bg-secondary p-4">
        <h2 className="font-medium">{t('voices.guideTitle')}</h2>
        <p className="text-sm">{t('voices.guide')}</p>
      </section>
    </div>
  )
}

function LanguageVoices({ lang }: { lang: string }) {
  const { t, i18n } = useTranslation()
  const { voicesFor, prefs } = useSpeech()
  const voices = voicesFor(lang)
  // The tapped choice shows at once; the stored preference catches up after the `meta` write.
  const [chosen, setChosen] = useState<string | null>(null)
  const selected = chosen ?? prefs.voicePref[lang] ?? ''
  const name = `voice-${lang}`

  function choose(voiceURI: string) {
    setChosen(voiceURI)
    const { [lang]: _previous, ...others } = prefs.voicePref
    void setMeta('voice_pref', voiceURI ? { ...others, [lang]: voiceURI } : others)
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">
        {languageName(lang, i18n.language)} <span className="text-sm text-muted-foreground">{lang}</span>
      </h2>
      {voices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('voices.none')}</p>
      ) : (
        <fieldset className="flex flex-col divide-y rounded-2xl border bg-card">
          <legend className="sr-only">{languageName(lang, i18n.language)}</legend>
          <VoiceOption name={name} value="" checked={selected === ''} label={t('voices.auto')} onChoose={choose} />
          {voices.map((voice) => (
            <VoiceOption
              key={voice.voiceURI}
              name={name}
              value={voice.voiceURI}
              checked={selected === voice.voiceURI}
              label={voice.name}
              detail={`${voice.lang} · ${t(`voices.quality.${voiceQuality(voice)}`)}`}
              quality={voiceQuality(voice)}
              onChoose={choose}
              onSample={() => void speak(sampleText(lang), { lang, rate: prefs.rate, voiceURI: voice.voiceURI })}
            />
          ))}
        </fieldset>
      )}
    </section>
  )
}

type VoiceOptionProps = {
  name: string
  value: string
  checked: boolean
  label: string
  detail?: string
  quality?: string
  onChoose: (voiceURI: string) => void
  onSample?: () => void
}

function VoiceOption({ name, value, checked, label, detail, quality, onChoose, onSample }: VoiceOptionProps) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-14 items-center gap-2 pr-1 pl-4">
      <label className="flex min-w-0 flex-1 items-center gap-3 py-2">
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          onChange={() => onChoose(value)}
          className="size-5 shrink-0 accent-primary"
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{label}</span>
          {detail && (
            <span className={cn('text-sm text-muted-foreground', quality === 'premium' && 'text-good')}>{detail}</span>
          )}
        </span>
      </label>
      {onSample && (
        <Button variant="ghost" size="icon-xl" aria-label={t('voices.sample', { name: label })} onClick={onSample}>
          <Play className="size-5" />
        </Button>
      )}
    </div>
  )
}
