import { useNavigate } from '@tanstack/react-router'
import { Loader2, Plus } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { EnrichResponse } from '@/api/model'
import { useSnackbar } from '@/components/Snackbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { createCard } from '@/db/cards'
import { useDecks, useMeta } from '@/db/hooks'
import { setMeta } from '@/db/meta'
import { validateCardInput } from '@/domain/cardValidation'
import type { Deck } from '@/domain/types'
import { enrichErrorKey, useEnrich } from '@/features/enrich/useEnrich'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
import { apiErrorCode } from '@/lib/api'
import { fieldErrorMessages } from '@/lib/fieldErrors'
import { useDuplicate } from './DuplicateWarning'

/** Floating "+" on Today and Decks that opens Quick add (ui_ux.md §3, S-09). */
export function QuickAddButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        size="icon-xl"
        className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 size-14 rounded-full shadow-lg"
        aria-label={t('cards.quickAdd.open')}
        onClick={() => setOpen(true)}
      >
        <Plus className="size-7" />
      </Button>
      <QuickAddSheet open={open} onOpenChange={setOpen} />
    </>
  )
}

type SheetProps = { open: boolean; onOpenChange: (open: boolean) => void }

/**
 * S-09 Quick add. Online with AI (signed in, enrichment offered): word → Enter → suggestion card → Save (or Enter)
 * saves the word with the suggested fields; "Edit" opens the card editor with them as ghosts. Otherwise (offline,
 * no AI, or the request failed): word → Enter → translation → Enter saves. After a save the fields are cleared and
 * the focus returns to the word so the keyboard stays open.
 */
export function QuickAddSheet({ open, onOpenChange }: SheetProps) {
  const { t } = useTranslation()
  const keyboardInset = useKeyboardInset()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-[720px]" style={{ bottom: keyboardInset }}>
        <SheetHeader>
          <SheetTitle className="text-lg">{t('cards.quickAdd.title')}</SheetTitle>
          <SheetDescription className="sr-only">{t('cards.quickAdd.wordHint')}</SheetDescription>
        </SheetHeader>
        <QuickAddForm onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  )
}

function QuickAddForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const decks = useDecks()
  const lastDeckId = useMeta('last_quick_add_deck')
  const choices = decks?.filter((deck) => deck.archived_at === null)

  if (!choices || lastDeckId === undefined) return null
  if (choices.length === 0) {
    return (
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-muted-foreground">{t('cards.editor.noDecks')}</p>
        <Button
          size="xl"
          onClick={() => {
            onClose()
            navigate({ to: '/decks' })
          }}
        >
          {t('cards.editor.goToDecks')}
        </Button>
      </div>
    )
  }
  const initialDeck = choices.find((deck) => deck.id === lastDeckId) ?? choices[0]
  return <QuickAddWordForm decks={choices} initialDeckId={initialDeck?.id ?? ''} onClose={onClose} />
}

type Step = 'word' | 'suggesting' | 'suggestion' | 'translation'

function QuickAddWordForm({
  decks,
  initialDeckId,
  onClose,
}: {
  decks: Deck[]
  initialDeckId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const snackbar = useSnackbar()
  const [deckId, setDeckId] = useState(initialDeckId)
  const [word, setWord] = useState('')
  const [translation, setTranslation] = useState('')
  const [step, setStep] = useState<Step>('word')
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [suggestion, setSuggestion] = useState<EnrichResponse | null>(null)
  /** Error code of a failed suggestion request, shown as a one-line hint above the translation field. */
  const [enrichFailure, setEnrichFailure] = useState<string | null>(null)
  const wordRef = useRef<HTMLInputElement>(null)
  const translationRef = useRef<HTMLInputElement>(null)
  // Answers for a word that was changed or saved meanwhile are dropped.
  const requestId = useRef(0)
  const duplicate = useDuplicate(deckId, word)
  const blockedByDuplicate = duplicate !== undefined && !allowDuplicate
  const deck = decks.find((d) => d.id === deckId)
  const enrichment = useEnrich()

  function toTranslation() {
    // flushSync renders the translation field now, so it can take the focus inside this key event (iOS only
    // moves the keyboard to a field focused during a user gesture).
    flushSync(() => setStep('translation'))
    translationRef.current?.focus()
  }

  /** Asks for suggestions when AI is available; otherwise (or when that fails) the translation field appears. */
  async function next() {
    if (!enrichment.canEnrich || !deck) {
      toTranslation()
      return
    }
    const id = ++requestId.current
    setStep('suggesting')
    try {
      const answer = await enrichment.suggest({
        front: word.trim(),
        target_lang: deck.target_lang,
        native_lang: deck.native_lang,
      })
      if (id !== requestId.current) return
      setSuggestion(answer)
      setStep('suggestion')
    } catch (failure) {
      if (id !== requestId.current) return
      setEnrichFailure(apiErrorCode(failure))
      toTranslation()
    }
  }

  /** Suggestions belong to the word and the deck languages they were made for. */
  function dropSuggestion() {
    if (step !== 'suggesting' && step !== 'suggestion') return
    requestId.current++
    setSuggestion(null)
    setStep('word')
  }

  function editSuggestion() {
    if (!suggestion) return
    onClose()
    navigate({
      to: '/cards/new',
      search: { deck: deckId },
      state: { enrich: { front: word.trim(), suggestion } },
    })
  }

  function save() {
    // The duplicate check may finish only after the word step; then the warning must be answered first.
    if (blockedByDuplicate) return
    const draft =
      step === 'suggestion' && suggestion
        ? { deck_id: deckId, front: word, ...suggestion }
        : { deck_id: deckId, front: word, back: translation }
    const { value, errors: fieldErrors } = validateCardInput(draft)
    if (fieldErrors.length > 0) {
      setErrors(fieldErrorMessages(t, fieldErrors))
      return
    }
    // Reset and refocus synchronously so the keyboard stays open; the write finishes in the background.
    requestId.current++
    flushSync(() => {
      setWord('')
      setTranslation('')
      setStep('word')
      setAllowDuplicate(false)
      setErrors({})
      setSuggestion(null)
      setEnrichFailure(null)
    })
    wordRef.current?.focus()
    void createCard(value).then((card) => {
      void setMeta('last_quick_add_deck', card.deck_id)
      snackbar.show({
        message: t('cards.quickAdd.added'),
        actionLabel: t('cards.quickAdd.edit'),
        onAction: () => {
          onClose()
          navigate({ to: '/cards/$cardId/edit', params: { cardId: card.id } })
        },
      })
    })
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (step === 'word') {
      if (word.trim() === '' || blockedByDuplicate) return
      void next()
    } else if (step !== 'suggesting') {
      save()
    }
  }

  // Whether Enter asks for suggestions must be known before the first word is typed.
  if (!enrichment.ready) return null

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 px-4 pb-4">
      <select
        aria-label={t('cards.quickAdd.deck')}
        className="h-11 rounded-lg border border-input bg-transparent px-3"
        value={deckId}
        onChange={(event) => {
          setDeckId(event.target.value)
          void setMeta('last_quick_add_deck', event.target.value)
          dropSuggestion()
        }}
      >
        {decks.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>

      <Input
        ref={wordRef}
        aria-label={t('cards.quickAdd.word')}
        placeholder={t('cards.quickAdd.word')}
        lang={deck?.target_lang}
        autoFocus
        autoCapitalize="none"
        autoComplete="off"
        enterKeyHint="next"
        value={word}
        aria-invalid={errors.front ? true : undefined}
        onChange={(event) => {
          setWord(event.target.value)
          setAllowDuplicate(false)
          dropSuggestion()
        }}
      />
      {errors.front && <p className="text-sm text-destructive">{errors.front}</p>}

      {duplicate && !allowDuplicate && (
        <div className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950" role="status">
          <p>{t('cards.quickAdd.duplicate', { front: duplicate.front, back: duplicate.back })}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="xl"
              variant="outline"
              onClick={() => {
                setAllowDuplicate(true)
                void next()
              }}
            >
              {t('cards.quickAdd.addAnyway')}
            </Button>
            <Button
              type="button"
              size="xl"
              variant="ghost"
              onClick={() => {
                onClose()
                navigate({ to: '/cards/$cardId', params: { cardId: duplicate.id } })
              }}
            >
              {t('cards.quickAdd.openExisting')}
            </Button>
          </div>
        </div>
      )}

      {step === 'suggesting' && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t('enrich.working')}
        </p>
      )}

      {step === 'suggestion' && suggestion && (
        <section aria-label={t('enrich.suggestions')} className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3">
          <p lang={deck?.native_lang} className="text-lg font-semibold break-words">
            {suggestion.back}
          </p>
          {suggestion.ipa && <p className="text-sm text-muted-foreground">{suggestion.ipa}</p>}
          {suggestion.example && (
            <p lang={deck?.target_lang} className="break-words italic">
              {suggestion.example}
            </p>
          )}
          {suggestion.example_translation && (
            <p lang={deck?.native_lang} className="text-sm break-words text-muted-foreground">
              {suggestion.example_translation}
            </p>
          )}
          {suggestion.notes && (
            <p lang={deck?.native_lang} className="text-sm break-words text-muted-foreground">
              {suggestion.notes}
            </p>
          )}
          <Button type="button" size="xl" variant="ghost" className="self-start" onClick={editSuggestion}>
            {t('cards.quickAdd.edit')}
          </Button>
        </section>
      )}

      {step === 'translation' && (
        <>
          {enrichFailure && <p className="text-sm text-muted-foreground">{t(enrichErrorKey(enrichFailure))}</p>}
          <Input
            ref={translationRef}
            aria-label={t('cards.quickAdd.translation')}
            placeholder={t('cards.quickAdd.translation')}
            lang={deck?.native_lang}
            autoCapitalize="none"
            autoComplete="off"
            enterKeyHint="done"
            value={translation}
            aria-invalid={errors.back ? true : undefined}
            onChange={(event) => setTranslation(event.target.value)}
          />
          {errors.back && <p className="text-sm text-destructive">{errors.back}</p>}
        </>
      )}

      <Button
        type="submit"
        size="xl"
        disabled={word.trim() === '' || step === 'suggesting' || (step === 'word' && blockedByDuplicate)}
      >
        {step === 'suggestion' ? t('common.save') : t('cards.quickAdd.add')}
      </Button>
    </form>
  )
}
