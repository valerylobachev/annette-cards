import { Link, useNavigate } from '@tanstack/react-router'
import { Archive, ChevronRight, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { EmptyState } from '@/components/EmptyState'
import { useSnackbar } from '@/components/Snackbar'
import { SwipeRow } from '@/components/SwipeRow'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { archiveDeck, type DeckWithSummary, deleteDeck, unarchiveDeck, undeleteDeck } from '@/db/decks'
import { useDeckSummaries } from '@/db/hooks'
import type { Deck } from '@/domain/types'
import { usePullToReveal } from '@/hooks/usePullToReveal'
import { languageTag } from '@/lib/intl'
import { type DeckFormMode, DeckFormSheet } from './DeckFormSheet'

/** Undo window after deleting a deck (ui_ux.md §7). */
const DELETE_UNDO_MS = 10_000
const SWIPE_ACTIONS_WIDTH = 160

type DeckActions = {
  edit: (mode: DeckFormMode, deck: Deck) => void
  archive: (deck: Deck) => void
  unarchive: (deck: Deck) => void
  requestDelete: (row: DeckWithSummary) => void
}

/** S-05 Decks list. */
export function DecksListPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const snackbar = useSnackbar()
  const rows = useDeckSummaries()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [form, setForm] = useState<{ mode: DeckFormMode; deck?: Deck } | null>(null)
  const [toDelete, setToDelete] = useState<DeckWithSummary | null>(null)

  usePullToReveal(() => setSearchOpen(true))

  const actions: DeckActions = {
    edit: (mode, deck) => setForm({ mode, deck }),
    archive: async (deck) => {
      await archiveDeck(deck.id)
      snackbar.show({
        message: t('snackbar.deckArchived'),
        actionLabel: t('common.undo'),
        onAction: () => unarchiveDeck(deck.id),
      })
    },
    unarchive: (deck) => unarchiveDeck(deck.id),
    requestDelete: setToDelete,
  }

  async function confirmDelete(row: DeckWithSummary) {
    await deleteDeck(row.deck.id)
    snackbar.show({
      message: t('snackbar.deckDeleted'),
      actionLabel: t('common.undo'),
      onAction: () => undeleteDeck(row.deck.id),
      duration: DELETE_UNDO_MS,
    })
  }

  const needle = query.trim().toLocaleLowerCase()
  const visible = (rows ?? []).filter((row) => !needle || row.deck.name.toLocaleLowerCase().includes(needle))
  const active = visible.filter((row) => row.deck.archived_at === null)
  const archived = visible.filter((row) => row.deck.archived_at !== null)

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col pt-4">
      <header className="flex min-h-11 items-center gap-1 px-4">
        <h1 className="flex-1 text-2xl font-semibold">{t('screens.decks.title')}</h1>
        <Button
          variant="ghost"
          size="icon-xl"
          aria-label={t('common.search')}
          aria-expanded={searchOpen}
          onClick={() => setSearchOpen((open) => !open)}
        >
          <Search className="size-5" />
        </Button>
        <Button variant="ghost" size="xl" onClick={() => setForm({ mode: 'create' })}>
          <Plus className="size-5" />
          {t('decks.new')}
        </Button>
      </header>

      {searchOpen && (
        <div className="px-4 pt-2">
          <Input
            type="search"
            autoFocus
            value={query}
            placeholder={t('decks.searchPlaceholder')}
            aria-label={t('decks.searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}

      {rows && rows.length === 0 && (
        <EmptyState
          message={t('decks.empty')}
          actionLabel={t('decks.create')}
          onAction={() => setForm({ mode: 'create' })}
        >
          <Button size="xl" variant="outline" onClick={() => navigate({ to: '/import' })}>
            {t('decks.importFile')}
          </Button>
        </EmptyState>
      )}

      {rows && rows.length > 0 && visible.length === 0 && (
        <p className="px-4 py-8 text-center text-muted-foreground">{t('decks.noMatches')}</p>
      )}

      <ul className="mt-2 divide-y" aria-label={t('screens.decks.title')}>
        {active.map((row) => (
          <DeckRow key={row.deck.id} row={row} actions={actions} />
        ))}
      </ul>

      {archived.length > 0 && (
        <section className="mt-6">
          <Button
            variant="ghost"
            size="xl"
            className="mx-2 justify-start text-muted-foreground"
            aria-expanded={archivedOpen}
            onClick={() => setArchivedOpen((open) => !open)}
          >
            <ChevronRight
              className={archivedOpen ? 'size-5 rotate-90 transition-transform' : 'size-5 transition-transform'}
            />
            {t('decks.archived', { count: archived.length })}
          </Button>
          {archivedOpen && (
            <ul className="divide-y opacity-80" aria-label={t('decks.archived', { count: archived.length })}>
              {archived.map((row) => (
                <DeckRow key={row.deck.id} row={row} actions={actions} />
              ))}
            </ul>
          )}
        </section>
      )}

      <DeckFormSheet
        mode={form?.mode ?? 'create'}
        deck={form?.deck}
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
      />

      <ConfirmSheet
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t('decks.deleteConfirm', { count: toDelete?.summary.cards ?? 0 })}
        description={toDelete ? `«${toDelete.deck.name}» · ${t('decks.deleteHint')}` : undefined}
        confirmLabel={t('common.delete')}
        onConfirm={() => toDelete && confirmDelete(toDelete)}
      />
    </div>
  )
}

function DeckRow({ row, actions }: { row: DeckWithSummary; actions: DeckActions }) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const { deck, summary } = row
  const isArchived = deck.archived_at !== null

  return (
    <li>
      <SwipeRow
        actionsWidth={SWIPE_ACTIONS_WIDTH}
        onLongPress={() => setMenuOpen(true)}
        actions={(close) => (
          <>
            <button
              type="button"
              className="flex flex-1 flex-col items-center justify-center gap-1 bg-secondary text-sm"
              onClick={() => {
                close()
                isArchived ? actions.unarchive(deck) : actions.archive(deck)
              }}
            >
              <Archive className="size-5" aria-hidden />
              {isArchived ? t('common.unarchive') : t('common.archive')}
            </button>
            <button
              type="button"
              className="flex flex-1 flex-col items-center justify-center gap-1 bg-destructive text-sm text-white"
              onClick={() => {
                close()
                actions.requestDelete(row)
              }}
            >
              <Trash2 className="size-5" aria-hidden />
              {t('common.delete')}
            </button>
          </>
        )}
      >
        <Link
          to="/decks/$deckId"
          params={{ deckId: deck.id }}
          className="flex min-w-0 flex-1 flex-col gap-1 py-3 pl-4"
          draggable={false}
        >
          <span className="truncate text-base font-medium">{deck.name}</span>
          <span className="text-sm text-muted-foreground">
            {t('decks.languagePair', { target: languageTag(deck.target_lang), native: languageTag(deck.native_lang) })}
            {' · '}
            {t('cards.count', { count: summary.cards })}
          </span>
          <ProgressBar summary={summary} />
        </Link>
        {summary.due > 0 && (
          <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
            <span aria-hidden>{summary.due}</span>
            <span className="sr-only">{t('decks.due', { count: summary.due })}</span>
          </span>
        )}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xl"
              className="mr-1"
              aria-label={t('decks.actionsFor', { name: deck.name })}
            >
              <MoreHorizontal className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          {/* Items open sheets; returning focus to the trigger would make the new sheet close itself. */}
          <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
            <DropdownMenuItem onSelect={() => actions.edit('rename', deck)}>{t('common.rename')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.edit('edit', deck)}>{t('common.settings')}</DropdownMenuItem>
            {/* Deck CSV export arrives with P1-T06. */}
            <DropdownMenuItem disabled>{t('common.export')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => (isArchived ? actions.unarchive(deck) : actions.archive(deck))}>
              {isArchived ? t('common.unarchive') : t('common.archive')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => actions.requestDelete(row)}>
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SwipeRow>
    </li>
  )
}

function ProgressBar({ summary }: { summary: DeckWithSummary['summary'] }) {
  const { t } = useTranslation()
  const total = summary.new + summary.learning + summary.mature
  if (total === 0) return null
  const percent = (value: number) => `${(value / total) * 100}%`

  return (
    <div
      role="img"
      aria-label={t('decks.progress', { new: summary.new, learning: summary.learning, mature: summary.mature })}
      className="mt-1 flex h-1.5 w-full max-w-60 overflow-hidden rounded-full bg-muted"
    >
      <div className="bg-sky-400" style={{ width: percent(summary.new) }} />
      <div className="bg-amber-400" style={{ width: percent(summary.learning) }} />
      <div className="bg-green-500" style={{ width: percent(summary.mature) }} />
    </div>
  )
}
