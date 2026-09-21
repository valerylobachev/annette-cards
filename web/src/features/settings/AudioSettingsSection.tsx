import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useMeta, useSettings } from '@/db/hooks'
import { setMeta } from '@/db/meta'
import { updateSettings } from '@/db/settings'
import type { Autoplay } from '@/domain/types'
import { DEFAULT_SPEECH_RATE, SPEECH_RATE_RANGE } from '@/lib/speech/speech'

const AUTOPLAY: Autoplay[] = ['off', 'front', 'front_and_back']

/** S-14 Audio: autoplay (synced setting), speech rate (this device) and the Voices screen. */
export function AudioSettingsSection() {
  const { t, i18n } = useTranslation()
  const settings = useSettings()
  const rate = useMeta('speech_rate') ?? DEFAULT_SPEECH_RATE

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">{t('speech.audio')}</h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-muted-foreground">{t('speech.autoplay')}</legend>
        <div className="flex flex-wrap gap-2">
          {AUTOPLAY.map((value) => (
            <Button
              key={value}
              size="lg"
              variant={settings.autoplay === value ? 'default' : 'outline'}
              aria-pressed={settings.autoplay === value}
              onClick={() => void updateSettings({ autoplay: value })}
            >
              {t(`speech.autoplayOptions.${value}`)}
            </Button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-2">
        <span className="flex justify-between text-sm text-muted-foreground">
          {t('speech.rate')}
          <span className="tabular-nums">
            {t('speech.rateValue', { rate: new Intl.NumberFormat(i18n.language).format(rate) })}
          </span>
        </span>
        <input
          type="range"
          min={SPEECH_RATE_RANGE.min}
          max={SPEECH_RATE_RANGE.max}
          step={SPEECH_RATE_RANGE.step}
          value={rate}
          onChange={(event) => void setMeta('speech_rate', Number(event.target.value))}
          className="h-11 accent-primary"
        />
      </label>
      <Button asChild size="xl" variant="outline" className="justify-between">
        <Link to="/settings/voices">
          {t('speech.voices')}
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </Button>
    </section>
  )
}
