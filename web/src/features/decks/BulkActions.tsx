import { useLiveQuery } from 'dexie-react-hooks'
import { FolderInput, RotateCcw, Tag, TagsIcon, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { useSnackbar } from '@/components/Snackbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { resetProgress } from '@/db/cardStates'
import { addTag, moveCards, removeTag } from '@/db/cards'
import { useDecks, useTags } from '@/db/hooks'
import { db } from '@/db/schema'
import type { Deck } from '@/domain/types'

type Action = 'move' | 'addTag' | 'removeTag' | 'reset' | 'delete'

type Props = {
  deck: Deck
  selected: string[]
  onDelete: (ids: string[]) => void
  onDone: () => void
}

/** Bottom action bar of the deck detail selection mode (S-06): move, add/remove tag, reset, delete. */
export function BulkActions({ deck, selected, onDelete, onDone }: Props) {
  const { t } = useTranslation()
  const snackbar = useSnackbar()
  const [action, setAction] = useState<Action | null>(null)
  const count = selected.length
  const close = (open: boolean) => !open && setAction(null)

  const buttons: { name: Action; label: string; icon: typeof Tag }[] = [
    { name: 'move', label: t('deck.bulk.move'), icon: FolderInput },
    { name: 'addTag', label: t('deck.bulk.addTag'), icon: Tag },
    { name: 'removeTag', label: t('deck.bulk.removeTag'), icon: TagsIcon },
    { name: 'reset', label: t('deck.bulk.reset'), icon: RotateCcw },
    { name: 'delete', label: t('deck.bulk.delete'), icon: Trash2 },
  ]

  return (
    <>
      <div
        role="toolbar"
        aria-label={t('deck.bulk.label')}
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t bg-background/95 backdrop-blur"
      >
        <div className="mx-auto grid max-w-[720px] grid-cols-5">
          {buttons.map(({ name, label, icon: Icon }) => (
            <button
              key={name}
              type="button"
              disabled={count === 0}
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs disabled:opacity-40 data-[danger=true]:text-destructive"
              data-danger={name === 'delete'}
              onClick={() => setAction(name)}
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      <MoveSheet
        open={action === 'move'}
        onOpenChange={close}
        currentDeckId={deck.id}
        count={count}
        onMove={async (target) => {
          setAction(null)
          await moveCards(selected, target)
          snackbar.show({ message: t('snackbar.cardsMoved') })
          onDone()
        }}
      />
      <TagSheet
        mode="add"
        open={action === 'addTag'}
        onOpenChange={close}
        selected={selected}
        onPick={async (tag) => {
          setAction(null)
          await addTag(selected, tag)
        }}
      />
      <TagSheet
        mode="remove"
        open={action === 'removeTag'}
        onOpenChange={close}
        selected={selected}
        onPick={async (tag) => {
          setAction(null)
          await removeTag(selected, tag)
        }}
      />
      <ConfirmSheet
        open={action === 'reset'}
        onOpenChange={close}
        title={t('deck.bulk.resetConfirm', { count })}
        description={t('deck.bulk.resetHint')}
        confirmLabel={t('deck.bulk.reset')}
        onConfirm={async () => {
          await resetProgress(selected)
          snackbar.show({ message: t('snackbar.progressReset') })
          onDone()
        }}
      />
      <ConfirmSheet
        open={action === 'delete'}
        onOpenChange={close}
        title={t('deck.bulk.deleteConfirm', { count })}
        confirmLabel={t('common.delete')}
        onConfirm={() => onDelete(selected)}
      />
    </>
  )
}

type MoveSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentDeckId: string
  count: number
  onMove: (deck_id: string) => void
}

function MoveSheet({ open, onOpenChange, currentDeckId, count, onMove }: MoveSheetProps) {
  const { t } = useTranslation()
  const decks = useDecks()
  const targets = (decks ?? []).filter((deck) => deck.id !== currentDeckId && deck.archived_at === null)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-[720px]">
        <SheetHeader>
          <SheetTitle className="text-lg">{t('deck.bulk.moveTitle', { count })}</SheetTitle>
          <SheetDescription className="sr-only">{t('deck.bulk.moveTitle', { count })}</SheetDescription>
        </SheetHeader>
        <ul className="flex flex-col px-2 pb-4">
          {targets.map((deck) => (
            <li key={deck.id}>
              <Button variant="ghost" size="xl" className="w-full justify-start" onClick={() => onMove(deck.id)}>
                {deck.name}
              </Button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  )
}

type TagSheetProps = {
  mode: 'add' | 'remove'
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: string[]
  onPick: (tag: string) => void
}

function TagSheet({ mode, open, onOpenChange, selected, onPick }: TagSheetProps) {
  const { t } = useTranslation()
  const allTags = useTags()
  const selectedTags = useLiveQuery(
    async () => {
      const cards = await db.cards.bulkGet(selected)
      return [...new Set(cards.flatMap((card) => card?.tags ?? []))].sort((a, b) => a.localeCompare(b))
    },
    [selected.join()],
    [],
  )
  const [text, setText] = useState('')
  const title = mode === 'add' ? t('deck.bulk.addTagTitle') : t('deck.bulk.removeTagTitle')
  const choices = mode === 'add' ? allTags : selectedTags

  function submit(event: FormEvent) {
    event.preventDefault()
    if (text.trim() === '') return
    onPick(text)
    setText('')
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-[720px]">
        <SheetHeader>
          <SheetTitle className="text-lg">{title}</SheetTitle>
          <SheetDescription className="sr-only">{title}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {mode === 'add' && (
            <form onSubmit={submit} className="flex gap-2">
              <Input
                aria-label={t('deck.bulk.tagName')}
                placeholder={t('deck.bulk.tagName')}
                autoCapitalize="none"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              <Button type="submit" size="xl">
                {t('deck.bulk.addTag')}
              </Button>
            </form>
          )}
          <ul className="flex flex-wrap gap-1.5">
            {choices.map((tag) => (
              <li key={tag}>
                <button type="button" className="min-h-11 rounded-full border px-3 text-sm" onClick={() => onPick(tag)}>
                  #{tag}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  )
}
