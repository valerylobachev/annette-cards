import { useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router'
import { type FormEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/EmptyState'
import { FormField } from '@/components/FormField'
import { useSnackbar } from '@/components/Snackbar'
import { SpeakButton } from '@/components/SpeakButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createCard, updateCard } from '@/db/cards'
import { useCard, useDecks, useTags } from '@/db/hooks'
import type { CardDraft } from '@/domain/cardValidation'
import type { Card, Deck } from '@/domain/types'
import { ValidationError } from '@/domain/validation'
import { fieldErrorMessages } from '@/lib/fieldErrors'
import { DuplicateWarning, useDuplicate } from './DuplicateWarning'
import { IpaHelperRow } from './IpaHelperRow'
import { TagInput } from './TagInput'

/** S-08 in add mode: `/cards/new?deck=<id>`. */
export function CardNewPage() {
  const { deck } = useSearch({ from: '/cards/new' })
  const decks = useDecks()
  if (!decks) return null
  const choices = decks.filter((d) => d.archived_at === null)
  if (choices.length === 0) return <NoDecks />
  const initialDeck = choices.find((d) => d.id === deck) ?? choices[0]
  return <CardEditor decks={decks} initialDeckId={initialDeck?.id ?? ''} />
}

/** S-08 in edit mode: `/cards/<id>/edit`. */
export function CardEditPage() {
  const { t } = useTranslation()
  const { cardId } = useParams({ from: '/cards/$cardId/edit' })
  const card = useCard(cardId)
  const decks = useDecks()
  if (card === undefined || !decks) return null
  if (card === null) return <p className="px-4 py-16 text-center text-muted-foreground">{t('cards.editor.notFound')}</p>
  return <CardEditor decks={decks} card={card} initialDeckId={card.deck_id} />
}

function NoDecks() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <EmptyState
      message={t('cards.editor.noDecks')}
      actionLabel={t('cards.editor.goToDecks')}
      onAction={() => navigate({ to: '/decks' })}
    />
  )
}

/** Editor state: every text field is a string ('' = empty). */
type Fields = {
  front: string
  back: string
  example: string
  example_translation: string
  ipa: string
  tags: string[]
  notes: string
}

function fieldsOf(card?: Card): Fields {
  return {
    front: card?.front ?? '',
    back: card?.back ?? '',
    example: card?.example ?? '',
    example_translation: card?.example_translation ?? '',
    ipa: card?.ipa ?? '',
    tags: card?.tags ?? [],
    notes: card?.notes ?? '',
  }
}

type EditorProps = { decks: Deck[]; card?: Card; initialDeckId: string }

function CardEditor({ decks, card, initialDeckId }: EditorProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const navigate = useNavigate()
  const snackbar = useSnackbar()
  const tags = useTags()
  const [deckId, setDeckId] = useState(initialDeckId)
  const [fields, setFields] = useState<Fields>(() => fieldsOf(card))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [ipaFocused, setIpaFocused] = useState(false)
  const frontRef = useRef<HTMLInputElement>(null)
  const ipaRef = useRef<HTMLInputElement>(null)
  const duplicate = useDuplicate(deckId, fields.front, card?.id)

  const deck = decks.find((d) => d.id === deckId)
  // Archived decks are not offered, except the one the card is already in.
  const deckChoices = decks.filter((d) => d.archived_at === null || d.id === card?.deck_id)

  const set = (name: Exclude<keyof Fields, 'tags'>) => (event: { target: { value: string } }) =>
    setFields((current) => ({ ...current, [name]: event.target.value }))

  function goBack(deck_id: string) {
    if (router.history.canGoBack()) router.history.back()
    else navigate({ to: '/decks/$deckId', params: { deckId: deck_id } })
  }

  async function save(addAnother: boolean) {
    const draft: CardDraft = { deck_id: deckId, ...fields }
    try {
      const saved = card ? await updateCard(card.id, draft) : await createCard(draft)
      if (addAnother) {
        // Keep the deck and the tags for the next word (S-08).
        setFields({ ...fieldsOf(), tags: fields.tags })
        setErrors({})
        snackbar.show({ message: t('cards.editor.saved') })
        frontRef.current?.focus()
      } else {
        goBack(saved.deck_id)
      }
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      setErrors(fieldErrorMessages(t, error.errors))
    }
  }

  function insertIpa(symbol: string) {
    const input = ipaRef.current
    const start = input?.selectionStart ?? fields.ipa.length
    const end = input?.selectionEnd ?? start
    setFields((current) => ({ ...current, ipa: current.ipa.slice(0, start) + symbol + current.ipa.slice(end) }))
    requestAnimationFrame(() => input?.setSelectionRange(start + symbol.length, start + symbol.length))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void save(false)
  }

  const errorProps = (name: string) => ({
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `card-${name}-error` : undefined,
  })

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto flex w-full max-w-[720px] flex-col">
      <header className="sticky top-0 z-10 flex min-h-14 items-center gap-2 border-b bg-background px-2">
        <Button type="button" variant="ghost" size="xl" onClick={() => goBack(card?.deck_id ?? deckId)}>
          {t('common.cancel')}
        </Button>
        <h1 className="flex-1 truncate text-center text-lg font-semibold">
          {card ? t('screens.cardEdit.title') : t('screens.cardNew.title')}
        </h1>
        <Button type="submit" variant="ghost" size="xl" className="font-semibold text-primary">
          {t('common.save')}
        </Button>
      </header>

      <div className={`flex flex-col gap-5 px-4 pt-4 ${ipaFocused ? 'pb-20' : 'pb-8'}`}>
        <FormField id="card-deck" label={t('cards.editor.deck')}>
          <select
            id="card-deck"
            className="h-11 rounded-lg border border-input bg-transparent px-3"
            value={deckId}
            onChange={(event) => setDeckId(event.target.value)}
          >
            {deckChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </select>
        </FormField>

        <div className="flex flex-col gap-1.5">
          <FormField id="card-front" label={`${t('cards.editor.front')} *`} error={errors.front}>
            <div className="flex items-center gap-1">
              <Input
                id="card-front"
                ref={frontRef}
                lang={deck?.target_lang}
                autoCapitalize="none"
                autoComplete="off"
                autoFocus={!card}
                value={fields.front}
                onChange={set('front')}
                {...errorProps('front')}
              />
              {deck && (
                <SpeakButton
                  text={fields.front}
                  lang={deck.target_lang}
                  // The clip says the saved word: an edited front is spoken by the system voice.
                  audioId={card && fields.front.trim() === card.front ? card.audio_id : null}
                />
              )}
            </div>
          </FormField>
          {duplicate && <DuplicateWarning card={duplicate} />}
        </div>

        <FormField id="card-back" label={`${t('cards.editor.back')} *`} error={errors.back}>
          <Input
            id="card-back"
            lang={deck?.native_lang}
            autoCapitalize="none"
            autoComplete="off"
            value={fields.back}
            onChange={set('back')}
            {...errorProps('back')}
          />
        </FormField>

        <FormField id="card-example" label={t('cards.editor.example')} error={errors.example}>
          <Textarea
            id="card-example"
            lang={deck?.target_lang}
            rows={2}
            value={fields.example}
            onChange={set('example')}
            {...errorProps('example')}
          />
        </FormField>

        <FormField
          id="card-example_translation"
          label={t('cards.editor.exampleTranslation')}
          error={errors.example_translation}
        >
          <Textarea
            id="card-example_translation"
            lang={deck?.native_lang}
            rows={2}
            value={fields.example_translation}
            onChange={set('example_translation')}
            {...errorProps('example_translation')}
          />
        </FormField>

        <FormField id="card-ipa" label={t('cards.editor.ipa')} error={errors.ipa}>
          <Input
            id="card-ipa"
            ref={ipaRef}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={fields.ipa}
            onChange={set('ipa')}
            onFocus={() => setIpaFocused(true)}
            onBlur={() => setIpaFocused(false)}
            {...errorProps('ipa')}
          />
        </FormField>

        <FormField id="card-tags" label={t('cards.editor.tags')} error={errors.tags}>
          <TagInput
            id="card-tags"
            value={fields.tags}
            suggestions={tags}
            invalid={Boolean(errors.tags)}
            onChange={(next) => setFields((current) => ({ ...current, tags: next }))}
          />
        </FormField>

        <FormField id="card-notes" label={t('cards.editor.notes')} error={errors.notes}>
          <Textarea id="card-notes" rows={3} value={fields.notes} onChange={set('notes')} {...errorProps('notes')} />
        </FormField>

        {!card && (
          <Button type="button" size="xl" variant="secondary" onClick={() => save(true)}>
            {t('cards.editor.saveAndAddAnother')}
          </Button>
        )}
      </div>

      {ipaFocused && <IpaHelperRow onInsert={insertIpa} />}
    </form>
  )
}
