import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { createDeck, type DeckInput, updateDeck } from '@/db/decks'
import { useSettings } from '@/db/hooks'
import { DECK_NAME_MAX } from '@/domain/deckValidation'
import {
  DEFAULT_NATIVE_LANGUAGE,
  NATIVE_LANGUAGES,
  OTHER_STUDY_LANGUAGES,
  PINNED_STUDY_LANGUAGES,
} from '@/domain/languages'
import type { Deck, Directions } from '@/domain/types'
import { ValidationError } from '@/domain/validation'
import { fieldErrorMessages } from '@/lib/fieldErrors'
import { languageName } from '@/lib/intl'

/** `create` and `edit` show every field; `rename` shows the name only. */
export type DeckFormMode = 'create' | 'edit' | 'rename'

type Props = {
  mode: DeckFormMode
  deck?: Deck
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (deck: Deck) => void
}

const titleKeys = {
  create: 'decks.form.createTitle',
  edit: 'decks.form.settingsTitle',
  rename: 'decks.form.renameTitle',
} as const

/** Create deck sheet and deck settings sheet (S-05). */
export function DeckFormSheet({ mode, deck, open, onOpenChange, onSaved }: Props) {
  const { t } = useTranslation()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-[720px]">
        <SheetHeader>
          <SheetTitle className="text-lg">{t(titleKeys[mode])}</SheetTitle>
          <SheetDescription className="sr-only">{t(titleKeys[mode])}</SheetDescription>
        </SheetHeader>
        {/* Mounted only while open, so every opening starts from the deck's current values. */}
        <DeckForm
          mode={mode}
          deck={deck}
          onSaved={(saved) => {
            onOpenChange(false)
            onSaved?.(saved)
          }}
        />
      </SheetContent>
    </Sheet>
  )
}

const directionOptions: Directions[] = ['forward', 'reverse', 'both']

function includes(list: readonly string[], value: string) {
  return list.includes(value)
}

function DeckForm({ mode, deck, onSaved }: { mode: DeckFormMode; deck?: Deck; onSaved: (deck: Deck) => void }) {
  const { t, i18n } = useTranslation()
  const settings = useSettings()
  const [name, setName] = useState(deck?.name ?? '')
  const [targetLang, setTargetLang] = useState<string>(deck?.target_lang ?? PINNED_STUDY_LANGUAGES[0])
  const [nativeLang, setNativeLang] = useState(deck?.native_lang ?? DEFAULT_NATIVE_LANGUAGE)
  const [directions, setDirections] = useState<Directions | null>(deck?.directions ?? null)
  const [newPerDay, setNewPerDay] = useState(deck?.new_per_day?.toString() ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const effectiveDirections = directions ?? settings.default_directions
  const nativeOptions = includes(NATIVE_LANGUAGES, nativeLang) ? NATIVE_LANGUAGES : [nativeLang, ...NATIVE_LANGUAGES]
  const isPinned = includes(PINNED_STUDY_LANGUAGES, targetLang)
  // A deck may use a language outside the lists (e.g. created on another device); keep it selectable.
  const otherOptions = isPinned || includes(OTHER_STUDY_LANGUAGES, targetLang) ? [] : [targetLang]

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsedNewPerDay = newPerDay.trim() === '' ? null : Number(newPerDay)
    const input: DeckInput = {
      name,
      target_lang: targetLang,
      native_lang: nativeLang,
      directions: effectiveDirections,
      new_per_day: parsedNewPerDay,
    }
    try {
      const saved =
        mode === 'create'
          ? await createDeck(input)
          : await updateDeck(deck?.id ?? '', mode === 'rename' ? { name } : input)
      onSaved(saved)
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      setErrors(fieldErrorMessages(t, error.errors))
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 px-4" noValidate>
      <FormField id="deck-name" label={t('decks.form.name')} error={errors.name}>
        <Input
          id="deck-name"
          value={name}
          autoFocus={mode !== 'edit'}
          maxLength={DECK_NAME_MAX + 50}
          placeholder={t('decks.form.namePlaceholder')}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'deck-name-error' : undefined}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>

      {mode !== 'rename' && (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">{t('decks.form.targetLang')}</legend>
            <div className="flex flex-wrap gap-2">
              {PINNED_STUDY_LANGUAGES.map((code) => (
                <Button
                  key={code}
                  type="button"
                  size="xl"
                  variant={targetLang === code ? 'default' : 'outline'}
                  aria-pressed={targetLang === code}
                  onClick={() => setTargetLang(code)}
                >
                  {languageName(code, i18n.language)}
                </Button>
              ))}
            </div>
            <select
              aria-label={t('decks.form.otherLanguage')}
              className="h-11 rounded-lg border border-input bg-transparent px-3"
              value={isPinned ? '' : targetLang}
              onChange={(event) => event.target.value && setTargetLang(event.target.value)}
            >
              <option value="">{t('decks.form.otherLanguage')}</option>
              {[...otherOptions, ...OTHER_STUDY_LANGUAGES].map((code) => (
                <option key={code} value={code}>
                  {languageName(code, i18n.language)}
                </option>
              ))}
            </select>
          </fieldset>

          <FormField id="deck-native" label={t('decks.form.nativeLang')}>
            <select
              id="deck-native"
              className="h-11 rounded-lg border border-input bg-transparent px-3"
              value={nativeLang}
              onChange={(event) => setNativeLang(event.target.value)}
            >
              {nativeOptions.map((code) => (
                <option key={code} value={code}>
                  {languageName(code, i18n.language)}
                </option>
              ))}
            </select>
          </FormField>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">{t('decks.form.directions')}</legend>
            <div role="radiogroup" aria-label={t('decks.form.directions')} className="grid grid-cols-3 gap-2">
              {directionOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  role="radio"
                  size="xl"
                  aria-checked={effectiveDirections === option}
                  variant={effectiveDirections === option ? 'default' : 'outline'}
                  onClick={() => setDirections(option)}
                >
                  {t(`decks.form.${option}`)}
                </Button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{t(`decks.form.${effectiveDirections}Hint`)}</p>
          </fieldset>

          <FormField
            id="deck-new-per-day"
            label={t('decks.form.newPerDay')}
            error={errors.new_per_day}
            hint={t('decks.form.newPerDayHint', { count: settings.new_per_day })}
          >
            <Input
              id="deck-new-per-day"
              inputMode="numeric"
              pattern="[0-9]*"
              value={newPerDay}
              placeholder={String(settings.new_per_day)}
              aria-invalid={errors.new_per_day ? true : undefined}
              className="max-w-32"
              onChange={(event) => setNewPerDay(event.target.value)}
            />
          </FormField>
        </>
      )}

      <SheetFooter className="px-0">
        <Button type="submit" size="xl">
          {mode === 'create' ? t('common.create') : t('common.save')}
        </Button>
      </SheetFooter>
    </form>
  )
}
