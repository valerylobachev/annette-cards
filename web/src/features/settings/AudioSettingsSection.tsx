import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useMeta } from '@/db/hooks'
import { setMeta } from '@/db/meta'
import type { Autoplay } from '@/domain/types'
import { DEFAULT_SPEECH_RATE, SPEECH_RATE_RANGE } from '@/lib/speech/speech'
import { Segmented, SettingsGroup, SettingsRow, useSettingsDraft } from './SettingsList'

const AUTOPLAY: Autoplay[] = ['off', 'front', 'front_and_back']

/** S-14 Audio: autoplay (synced setting), speech rate (this device) and the Voices screen. */
export function AudioSettingsSection() {
  const { t, i18n } = useTranslation()
  const { settings, save } = useSettingsDraft()
  const rate = useMeta('speech_rate') ?? DEFAULT_SPEECH_RATE

  return (
    <SettingsGroup title={t('speech.audio')}>
      <SettingsRow label={t('speech.autoplay')} stacked>
        <Segmented<Autoplay>
          label={t('speech.autoplay')}
          value={settings.autoplay}
          options={AUTOPLAY.map((value) => ({ value, label: t(`speech.autoplayOptions.${value}`) }))}
          onChange={(autoplay) => save({ autoplay })}
        />
      </SettingsRow>
      <SettingsRow
        label={
          <span className="flex justify-between gap-2">
            {t('speech.rate')}
            <span className="tabular-nums">
              {t('speech.rateValue', { rate: new Intl.NumberFormat(i18n.language).format(rate) })}
            </span>
          </span>
        }
        htmlFor="speech-rate"
        stacked
      >
        <input
          id="speech-rate"
          type="range"
          min={SPEECH_RATE_RANGE.min}
          max={SPEECH_RATE_RANGE.max}
          step={SPEECH_RATE_RANGE.step}
          value={rate}
          onChange={(event) => void setMeta('speech_rate', Number(event.target.value))}
          className="h-11 accent-primary"
        />
      </SettingsRow>
      <Link to="/settings/voices" className="flex min-h-14 items-center justify-between gap-3 px-4 active:bg-muted">
        {t('speech.voices')}
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </Link>
    </SettingsGroup>
  )
}
