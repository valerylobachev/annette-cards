import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InstallHint } from '@/components/InstallHint'
import { StorageWarning } from '@/components/StorageWarning'
import { useMeta } from '@/db/hooks'
import { setMeta } from '@/db/meta'
import { updateSettings } from '@/db/settings'
import { SETTINGS_LIMITS } from '@/domain/settings'
import type { AnswerMode, Directions } from '@/domain/types'
import { type UiLanguage, uiLanguages } from '@/i18n'
import { formatPercent } from '@/lib/intl'
import { isStandalone } from '@/lib/platform'
import type { Theme } from '@/lib/theme'
import { AudioSettingsSection } from './AudioSettingsSection'
import { DataSection } from './DataSection'
import { NumberSelect, Segmented, SettingsGroup, SettingsRow, useSettingsDraft } from './SettingsList'

const range = (min: number, max: number, step = 1) =>
  Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => min + i * step)

const NEW_PER_DAY = range(SETTINGS_LIMITS.new_per_day.min, SETTINGS_LIMITS.new_per_day.max)
const MAX_REVIEWS = range(SETTINGS_LIMITS.max_reviews_per_day.min, SETTINGS_LIMITS.max_reviews_per_day.max, 10)
const HOURS = range(SETTINGS_LIMITS.day_start_hour.min, SETTINGS_LIMITS.day_start_hour.max)

/** S-14 Settings: study, audio, appearance, data and about (UC-21, UC-27). Account & sync arrives in Phase 2. */
export function SettingsPage() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pt-4 pb-8">
      <header className="flex min-h-11 items-center">
        <h1 className="text-2xl font-semibold">{t('screens.settings.title')}</h1>
      </header>
      <StorageWarning />
      <StudyGroup />
      <AudioSettingsSection />
      <AppearanceGroup />
      <DataSection />
      <AboutGroup />
    </div>
  )
}

function StudyGroup() {
  const { t, i18n } = useTranslation()
  const { settings, save } = useSettingsDraft()
  const { min, max } = SETTINGS_LIMITS.desired_retention

  return (
    <SettingsGroup title={t('settings.sections.study')}>
      <SettingsRow label={t('settings.newPerDay')} htmlFor="new-per-day">
        <NumberSelect
          id="new-per-day"
          values={NEW_PER_DAY}
          value={settings.new_per_day}
          onChange={(new_per_day) => save({ new_per_day })}
        />
      </SettingsRow>
      <SettingsRow label={t('settings.maxReviews')} htmlFor="max-reviews">
        <NumberSelect
          id="max-reviews"
          values={MAX_REVIEWS}
          value={settings.max_reviews_per_day}
          onChange={(max_reviews_per_day) => save({ max_reviews_per_day })}
        />
      </SettingsRow>
      <SettingsRow label={t('settings.defaultDirections')} stacked>
        <Segmented<Directions>
          label={t('settings.defaultDirections')}
          value={settings.default_directions}
          options={(['forward', 'reverse', 'both'] as const).map((value) => ({
            value,
            label: t(`decks.form.${value}`),
          }))}
          onChange={(default_directions) => save({ default_directions })}
        />
      </SettingsRow>
      <SettingsRow label={t('settings.answerMode')} stacked>
        <Segmented<AnswerMode>
          label={t('settings.answerMode')}
          value={settings.answer_mode}
          options={(['simple', 'detailed'] as const).map((value) => ({
            value,
            label: t(`settings.answerModes.${value}`),
          }))}
          onChange={(answer_mode) => save({ answer_mode })}
        />
      </SettingsRow>
      <SettingsRow label={t('settings.showIpa')} htmlFor="show-ipa">
        <input
          id="show-ipa"
          type="checkbox"
          role="switch"
          aria-checked={settings.show_ipa_on_front}
          checked={settings.show_ipa_on_front}
          onChange={(event) => save({ show_ipa_on_front: event.target.checked })}
          className="size-6 shrink-0 accent-primary"
        />
      </SettingsRow>
      <SettingsRow label={t('settings.dayStart')} htmlFor="day-start">
        <NumberSelect
          id="day-start"
          values={HOURS}
          value={settings.day_start_hour}
          format={(hour) => `${String(hour).padStart(2, '0')}:00`}
          onChange={(day_start_hour) => save({ day_start_hour })}
        />
      </SettingsRow>
      <SettingsRow
        label={
          <span className="flex justify-between gap-2">
            {t('settings.retention')}
            <span className="tabular-nums">{formatPercent(settings.desired_retention, i18n.language)}</span>
          </span>
        }
        htmlFor="retention"
        hint={t('settings.retentionHint')}
        stacked
      >
        <input
          id="retention"
          type="range"
          min={min}
          max={max}
          step={0.01}
          value={settings.desired_retention}
          onChange={(event) => save({ desired_retention: Number(event.target.value) })}
          className="h-11 accent-primary"
        />
      </SettingsRow>
      <p className="px-4 py-3 text-sm text-muted-foreground">{t('settings.changesNextSession')}</p>
    </SettingsGroup>
  )
}

function AppearanceGroup() {
  const { t, i18n } = useTranslation()
  const theme = useMeta('theme') ?? 'system'

  function changeLanguage(ui_language: UiLanguage) {
    void i18n.changeLanguage(ui_language)
    void updateSettings({ ui_language })
  }

  return (
    <SettingsGroup title={t('settings.sections.appearance')}>
      <SettingsRow label={t('settings.theme')} stacked>
        <Segmented<Theme>
          label={t('settings.theme')}
          value={theme}
          options={(['system', 'light', 'dark'] as const).map((value) => ({
            value,
            label: t(`settings.themes.${value}`),
          }))}
          onChange={(value) => void setMeta('theme', value)}
        />
      </SettingsRow>
      <SettingsRow label={t('settings.language')} stacked>
        <Segmented<UiLanguage>
          label={t('settings.language')}
          value={i18n.resolvedLanguage === 'ru' ? 'ru' : 'en'}
          options={uiLanguages.map((value) => ({ value, label: t(`languages.${value}`) }))}
          onChange={changeLanguage}
        />
      </SettingsRow>
    </SettingsGroup>
  )
}

function AboutGroup() {
  const { t } = useTranslation()
  const [installOpen, setInstallOpen] = useState(false)
  return (
    <SettingsGroup title={t('settings.sections.about')}>
      <SettingsRow label={t('settings.version')}>
        <span className="text-muted-foreground tabular-nums">{__APP_VERSION__}</span>
      </SettingsRow>
      {!isStandalone() && (
        <button
          type="button"
          className="flex min-h-14 items-center justify-between gap-3 px-4 text-left active:bg-muted"
          onClick={() => setInstallOpen(true)}
        >
          {t('settings.installApp')}
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </button>
      )}
      <details className="px-4 py-3">
        <summary className="min-h-8 cursor-pointer">{t('settings.licenses')}</summary>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
          {__LICENSES__.map(({ name, version, license }) => (
            <li key={name} className="flex justify-between gap-2">
              <span className="truncate">
                {name} {version}
              </span>
              <span className="shrink-0">{license}</span>
            </li>
          ))}
        </ul>
      </details>
      <InstallHint open={installOpen} onOpenChange={setInstallOpen} />
    </SettingsGroup>
  )
}
