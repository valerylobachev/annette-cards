import { Link, useNavigate } from '@tanstack/react-router'
import { Loader2, Volume2 } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { InstallSteps } from '@/components/InstallHint'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSettings } from '@/db/hooks'
import { setMeta } from '@/db/meta'
import { completeOnboarding } from '@/db/onboarding'
import { updateSettings } from '@/db/settings'
import {
  DEFAULT_NATIVE_LANGUAGE,
  NATIVE_LANGUAGES,
  OTHER_STUDY_LANGUAGES,
  PINNED_STUDY_LANGUAGES,
} from '@/domain/languages'
import { SETTINGS_LIMITS } from '@/domain/settings'
import { ValidationError } from '@/domain/validation'
import { useAccount } from '@/features/auth/account'
import { type UiLanguage, uiLanguages } from '@/i18n'
import { fieldErrorMessages } from '@/lib/fieldErrors'
import { languageName } from '@/lib/intl'
import { isIosSafari, isStandalone } from '@/lib/platform'
import { useSpeech } from '@/lib/speech/useSpeech'
import { requestPersistence } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { Segmented } from '../settings/SettingsList'

type Step = 'welcome' | 'languages' | 'goal' | 'deck' | 'install'
type DeckStart = 'import' | 'manual' | 'empty'

const GOALS = [5, 10, 15, 25] as const
const DEFAULT_GOAL = 15

/** A daily goal typed as "custom": a whole number within the new-cards limits, else `null`. */
export function parseCustomGoal(text: string): number | null {
  const value = Number(text.trim())
  const { min, max } = SETTINGS_LIMITS.new_per_day
  return text.trim() !== '' && Number.isInteger(value) && value >= min && value <= max ? value : null
}

function capitalize(text: string) {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

/**
 * S-01 onboarding (UC-01): UI language, studied and native language, daily goal, first deck and, in iOS Safari
 * outside the installed app, the install hint. Storage persistence is requested on the last step. Nothing is
 * written except the UI language until the first deck is chosen.
 */
export function OnboardingPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const settings = useSettings()
  const reducedMotion = useReducedMotion()
  const [installStep] = useState(() => isIosSafari() && !isStandalone())
  const steps: Step[] = ['welcome', 'languages', 'goal', 'deck', ...(installStep ? (['install'] as const) : [])]
  const [index, setIndex] = useState(0)
  const [targetLang, setTargetLang] = useState<string | null>(null)
  const [nativeLang, setNativeLang] = useState<string>(DEFAULT_NATIVE_LANGUAGE)
  const [goal, setGoal] = useState<number | 'custom'>(DEFAULT_GOAL)
  const [customGoal, setCustomGoal] = useState('')
  const [deckName, setDeckName] = useState<string | null>(null)
  const [start, setStart] = useState<DeckStart | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const step = steps[index] ?? 'welcome'
  const newPerDay = goal === 'custom' ? parseCustomGoal(customGoal) : goal
  // The language without its region ("Polish", not "Polish (Poland)").
  const defaultDeckName = targetLang ? capitalize(languageName(targetLang.split('-')[0] ?? '', i18n.language)) : ''
  const name = deckName ?? defaultDeckName
  const next = () => setIndex((current) => Math.min(current + 1, steps.length - 1))
  const back = () => setIndex((current) => Math.max(current - 1, 0))

  async function finish(choice: DeckStart) {
    if (!targetLang || newPerDay === null || busy) return
    setBusy(true)
    try {
      const deck = await completeOnboarding(
        { new_per_day: newPerDay },
        {
          name,
          target_lang: targetLang,
          native_lang: nativeLang,
          directions: settings.default_directions,
          new_per_day: null,
        },
      )
      if (choice === 'import') await navigate({ to: '/import', search: { deck: deck.id } })
      else if (choice === 'manual') await navigate({ to: '/cards/new', search: { deck: deck.id } })
      else await navigate({ to: '/' })
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      setErrors(fieldErrorMessages(t, error.errors))
      setIndex(steps.indexOf('deck'))
    } finally {
      setBusy(false)
    }
  }

  function chooseStart(choice: DeckStart) {
    if (installStep) {
      setStart(choice)
      next()
      return
    }
    void requestPersistence()
    void finish(choice)
  }

  function continueAfterInstall() {
    void requestPersistence()
    void setMeta('install_hint_shown', true)
    if (start) void finish(start)
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-[480px] flex-col gap-6 overflow-x-clip px-4 pt-6 pb-4">
      <div
        role="img"
        aria-label={t('onboarding.stepOf', { step: index + 1, total: steps.length })}
        className="flex justify-center gap-2"
      >
        {steps.map((id, position) => (
          <span key={id} className={cn('size-2 rounded-full', position === index ? 'bg-primary' : 'bg-secondary')} />
        ))}
      </div>
      <motion.div
        key={step}
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
        className="flex flex-1 flex-col gap-6"
      >
        {step === 'welcome' && <WelcomeStep onStart={next} />}
        {step === 'languages' && (
          <LanguagesStep
            targetLang={targetLang}
            nativeLang={nativeLang}
            onTargetLang={setTargetLang}
            onNativeLang={setNativeLang}
            footer={
              <StepButtons onBack={back}>
                <Button size="xl" className="flex-1" disabled={!targetLang} onClick={next}>
                  {t('onboarding.next')}
                </Button>
              </StepButtons>
            }
          />
        )}
        {step === 'goal' && (
          <GoalStep
            goal={goal}
            customGoal={customGoal}
            customValid={newPerDay !== null}
            onGoal={setGoal}
            onCustomGoal={setCustomGoal}
            footer={
              <StepButtons onBack={back}>
                <Button size="xl" className="flex-1" disabled={newPerDay === null} onClick={next}>
                  {t('onboarding.next')}
                </Button>
              </StepButtons>
            }
          />
        )}
        {step === 'deck' && (
          <DeckStep
            name={name}
            error={errors.name}
            busy={busy}
            onName={setDeckName}
            onChoose={chooseStart}
            footer={<StepButtons onBack={back} />}
          />
        )}
        {step === 'install' && (
          <section className="flex flex-1 flex-col gap-4">
            <h1 className="text-2xl font-semibold">{t('install.title')}</h1>
            <p className="text-muted-foreground">{t('install.why')}</p>
            <InstallSteps />
            <StepButtons onBack={back}>
              <Button size="xl" className="flex-1" disabled={busy} onClick={continueAfterInstall}>
                {t('onboarding.continue')}
              </Button>
            </StepButtons>
          </section>
        )}
      </motion.div>
    </div>
  )
}

function StepButtons({ onBack, children }: { onBack: () => void; children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="mt-auto flex gap-2 pt-2">
      <Button size="xl" variant="outline" onClick={onBack}>
        {t('common.back')}
      </Button>
      {children}
    </div>
  )
}

function WelcomeStep({ onStart }: { onStart: () => void }) {
  const { t, i18n } = useTranslation()
  // "I have an account" (UC-01 alt 2a) is hidden once this device is signed in.
  const signedOut = useAccount()?.account === null

  function changeLanguage(ui_language: UiLanguage) {
    void i18n.changeLanguage(ui_language)
    void updateSettings({ ui_language })
  }

  return (
    <section className="flex flex-1 flex-col gap-6">
      <div className="flex flex-1 flex-col justify-center gap-3 text-center">
        <h1 className="text-4xl font-semibold">{t('onboarding.appName')}</h1>
        <p className="text-lg text-muted-foreground">{t('onboarding.tagline')}</p>
      </div>
      <div className="flex justify-center">
        <Segmented<UiLanguage>
          label={t('settings.language')}
          value={i18n.resolvedLanguage === 'ru' ? 'ru' : 'en'}
          options={uiLanguages.map((value) => ({ value, label: t(`languages.${value}`) }))}
          onChange={changeLanguage}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Button size="xl" className="w-full" onClick={onStart}>
          {t('onboarding.getStarted')}
        </Button>
        {signedOut && (
          <Button size="xl" variant="outline" className="w-full" asChild>
            <Link to="/signin">{t('onboarding.haveAccount')}</Link>
          </Button>
        )}
      </div>
    </section>
  )
}

type LanguagesStepProps = {
  targetLang: string | null
  nativeLang: string
  onTargetLang: (lang: string) => void
  onNativeLang: (lang: string) => void
  footer: ReactNode
}

function LanguagesStep({ targetLang, nativeLang, onTargetLang, onNativeLang, footer }: LanguagesStepProps) {
  const { t, i18n } = useTranslation()
  const { hasVoice } = useSpeech()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const others = OTHER_STUDY_LANGUAGES.filter(
    (code) =>
      needle === '' ||
      languageName(code, i18n.language).toLocaleLowerCase().includes(needle) ||
      code.toLowerCase().includes(needle),
  )
  const silent = targetLang !== null && hasVoice(targetLang) === false

  const option = (code: string) => (
    <LanguageOption
      key={code}
      code={code}
      checked={targetLang === code}
      voice={hasVoice(code)}
      onChoose={onTargetLang}
    />
  )

  return (
    <section className="flex flex-1 flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('onboarding.languagesTitle')}</h1>
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 font-medium">{t('onboarding.learning')}</legend>
        <div className="flex flex-col divide-y rounded-2xl border bg-card">{PINNED_STUDY_LANGUAGES.map(option)}</div>
        <Input
          type="search"
          aria-label={t('onboarding.searchLanguages')}
          placeholder={t('onboarding.searchLanguages')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {others.length > 0 ? (
          <div className="flex max-h-72 flex-col divide-y overflow-y-auto rounded-2xl border bg-card">
            {others.map(option)}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('onboarding.noLanguagesFound')}</p>
        )}
      </fieldset>
      {silent && (
        <div role="status" className="flex flex-col gap-2 rounded-2xl bg-secondary p-4 text-sm">
          <p>{t('onboarding.noVoice', { language: languageName(targetLang, i18n.language) })}</p>
          <details>
            <summary className="min-h-11 cursor-pointer py-2.5 font-medium">{t('voices.guideTitle')}</summary>
            <p>{t('voices.guide')}</p>
          </details>
        </div>
      )}
      <FormField id="onboarding-native" label={t('onboarding.myLanguage')}>
        <select
          id="onboarding-native"
          className="h-11 rounded-lg border border-input bg-transparent px-3"
          value={nativeLang}
          onChange={(event) => onNativeLang(event.target.value)}
        >
          {NATIVE_LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {languageName(code, i18n.language)}
            </option>
          ))}
        </select>
      </FormField>
      {footer}
    </section>
  )
}

type LanguageOptionProps = {
  code: string
  checked: boolean
  /** `null` while the voice list loads. */
  voice: boolean | null
  onChoose: (code: string) => void
}

function LanguageOption({ code, checked, voice, onChoose }: LanguageOptionProps) {
  const { t, i18n } = useTranslation()
  return (
    <label className="flex min-h-12 items-center gap-3 px-4 py-2">
      <input
        type="radio"
        name="onboarding-target"
        value={code}
        checked={checked}
        onChange={() => onChoose(code)}
        className="size-5 shrink-0 accent-primary"
      />
      <span className="min-w-0 flex-1 truncate">{capitalize(languageName(code, i18n.language))}</span>
      {voice === null && (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t('onboarding.checkingVoices')} />
      )}
      {voice === true && (
        <span className="flex items-center gap-1 text-xs text-good">
          <Volume2 className="size-3.5" aria-hidden />
          {t('onboarding.voiceAvailable')}
        </span>
      )}
      <span className="text-xs text-muted-foreground">{code}</span>
    </label>
  )
}

type GoalStepProps = {
  goal: number | 'custom'
  customGoal: string
  customValid: boolean
  onGoal: (goal: number | 'custom') => void
  onCustomGoal: (text: string) => void
  footer: ReactNode
}

function GoalStep({ goal, customGoal, customValid, onGoal, onCustomGoal, footer }: GoalStepProps) {
  const { t } = useTranslation()
  const { min, max } = SETTINGS_LIMITS.new_per_day
  const options = [
    ...GOALS.map((value) => ({ value: String(value), label: String(value) })),
    { value: 'custom', label: t('onboarding.goalCustom') },
  ]

  return (
    <section className="flex flex-1 flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('onboarding.goalTitle')}</h1>
      <p className="text-muted-foreground">{t('onboarding.goalHint')}</p>
      <Segmented<string>
        label={t('onboarding.goalTitle')}
        value={String(goal)}
        options={options}
        onChange={(value) => onGoal(value === 'custom' ? 'custom' : Number(value))}
      />
      {goal === 'custom' && (
        <FormField
          id="onboarding-goal"
          label={t('onboarding.goalCustomLabel')}
          error={customGoal.trim() !== '' && !customValid ? t('onboarding.goalRange', { min, max }) : undefined}
        >
          <Input
            id="onboarding-goal"
            inputMode="numeric"
            pattern="[0-9]*"
            autoFocus
            className="max-w-32"
            value={customGoal}
            aria-invalid={customGoal.trim() !== '' && !customValid ? true : undefined}
            onChange={(event) => onCustomGoal(event.target.value)}
          />
        </FormField>
      )}
      <p className="rounded-2xl bg-secondary p-4 text-sm">{t('onboarding.srsExplained')}</p>
      {footer}
    </section>
  )
}

type DeckStepProps = {
  name: string
  error?: string
  busy: boolean
  onName: (name: string) => void
  onChoose: (choice: DeckStart) => void
  footer: ReactNode
}

function DeckStep({ name, error, busy, onName, onChoose, footer }: DeckStepProps) {
  const { t } = useTranslation()
  const choices: { value: DeckStart; hint: string }[] = [
    { value: 'import', hint: t('onboarding.startImportHint') },
    { value: 'manual', hint: t('onboarding.startManualHint') },
    { value: 'empty', hint: t('onboarding.startEmptyHint') },
  ]

  return (
    <section className="flex flex-1 flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('onboarding.deckTitle')}</h1>
      <FormField id="onboarding-deck-name" label={t('decks.form.name')} error={error}>
        <Input
          id="onboarding-deck-name"
          value={name}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onName(event.target.value)}
        />
      </FormField>
      <div className="flex flex-col gap-2">
        {choices.map(({ value, hint }) => (
          <Button
            key={value}
            size="xl"
            variant={value === 'import' ? 'default' : 'secondary'}
            className="h-auto min-h-14 flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
            disabled={busy}
            onClick={() => onChoose(value)}
          >
            <span className="text-base">{t(`onboarding.start.${value}`)}</span>
            <span className="text-xs font-normal opacity-80">{hint}</span>
          </Button>
        ))}
      </div>
      {footer}
    </section>
  )
}
