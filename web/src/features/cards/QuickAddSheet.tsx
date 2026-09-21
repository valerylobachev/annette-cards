import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useSnackbar } from '@/components/Snackbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { createCard } from '@/db/cards'
import { useDecks, useMeta } from '@/db/hooks'
import { setMeta } from '@/db/meta'
import { validateCardInput } from '@/domain/cardValidation'
import type { Deck } from '@/domain/types'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
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
 * S-09 Quick add. Phase 1 flow (online or offline): word → Enter → translation → Enter saves; the fields are
 * cleared and the focus returns to the word so the keyboard stays open. AI suggestions arrive in P3-T05.
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
  return <TwoFieldForm decks={choices} initialDeckId={initialDeck?.id ?? ''} onClose={onClose} />
}

function TwoFieldForm({
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
  const [step, setStep] = useState<'word' | 'translation'>('word')
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const wordRef = useRef<HTMLInputElement>(null)
  const translationRef = useRef<HTMLInputElement>(null)
  const duplicate = useDuplicate(deckId, word)
  const blockedByDuplicate = duplicate !== undefined && !allowDuplicate
  const deck = decks.find((d) => d.id === deckId)

  function toTranslation() {
    // flushSync renders the translation field now, so it can take the focus inside this key event (iOS only
    // moves the keyboard to a field focused during a user gesture).
    flushSync(() => setStep('translation'))
    translationRef.current?.focus()
  }

  function save() {
    // The duplicate check may finish only after the word step; then the warning must be answered first.
    if (blockedByDuplicate) return
    const { value, errors: fieldErrors } = validateCardInput({ deck_id: deckId, front: word, back: translation })
    if (fieldErrors.length > 0) {
      setErrors(fieldErrorMessages(t, fieldErrors))
      return
    }
    // Reset and refocus synchronously so the keyboard stays open; the write finishes in the background.
    flushSync(() => {
      setWord('')
      setTranslation('')
      setStep('word')
      setAllowDuplicate(false)
      setErrors({})
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
      toTranslation()
    } else {
      save()
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 px-4 pb-4">
      <select
        aria-label={t('cards.quickAdd.deck')}
        className="h-11 rounded-lg border border-input bg-transparent px-3"
        value={deckId}
        onChange={(event) => {
          setDeckId(event.target.value)
          void setMeta('last_quick_add_deck', event.target.value)
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
                toTranslation()
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

      {step === 'translation' && (
        <>
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

      <Button type="submit" size="xl" disabled={word.trim() === '' || (step === 'word' && blockedByDuplicate)}>
        {t('cards.quickAdd.add')}
      </Button>
    </form>
  )
}
