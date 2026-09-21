import { Link, useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { Check, ChevronLeft, MoreHorizontal, Search, Trash2 } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { deleteCards, undeleteCards } from '@/db/cards'
import { archiveDeck, deleteDeck, unarchiveDeck, undeleteDeck } from '@/db/decks'
import { useDeck, useDeckCards } from '@/db/hooks'
import {
  type CardSort,
  type CardWithStates,
  cardStatus,
  countByFilter,
  nextDue,
  queryCards,
  type StateFilter,
  tagsOf,
} from '@/domain/cardFilters'
import type { Deck } from '@/domain/types'
import { usePullToReveal } from '@/hooks/usePullToReveal'
import { languageTag, relativeTime } from '@/lib/intl'
import { cn } from '@/lib/utils'
import { BulkActions } from './BulkActions'
import { DeckFormSheet } from './DeckFormSheet'

const ROW_HEIGHT = 68
const SWIPE_ACTIONS_WIDTH = 88
const DELETE_UNDO_MS = 10_000
const filters: StateFilter[] = ['new', 'learning', 'review', 'difficult']
const sorts: CardSort[] = ['added_desc', 'due_asc', 'alpha', 'difficulty_desc']

export const statusDotClass = { new: 'bg-sky-400', learning: 'bg-amber-400', review: 'bg-green-500' } as const

/** S-06 Deck detail. */
export function DeckDetailPage() {
  const { t } = useTranslation()
  const { deckId } = useParams({ from: '/decks/$deckId' })
  const deck = useDeck(deckId)
  const items = useDeckCards(deckId)

  if (deck === undefined || items === undefined) return null
  if (deck === null || items === null) {
    return <p className="px-4 py-16 text-center text-muted-foreground">{t('deck.notFound')}</p>
  }
  return <DeckDetail deck={deck} items={items} />
}

function DeckDetail({ deck, items }: { deck: Deck; items: CardWithStates[] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const router = useRouter()
  const snackbar = useSnackbar()
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<StateFilter | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [sort, setSort] = useState<CardSort>('added_desc')
  const [selection, setSelection] = useState<Set<string> | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmDeckDelete, setConfirmDeckDelete] = useState(false)

  usePullToReveal(() => setSearchOpen(true))

  const counts = useMemo(() => countByFilter(items), [items])
  const tags = useMemo(() => tagsOf(items), [items])
  const visible = useMemo(() => queryCards(items, { search, filter, tag, sort }), [items, search, filter, tag, sort])

  function toggleSelected(id: string) {
    setSelection((current) => {
      const next = new Set(current ?? [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function removeCards(ids: string[]) {
    const deletedAt = await deleteCards(ids)
    snackbar.show({
      message: t('snackbar.cardsDeleted', { count: ids.length }),
      actionLabel: t('common.undo'),
      onAction: () => undeleteCards(ids, deletedAt),
    })
  }

  async function removeDeck() {
    await deleteDeck(deck.id)
    navigate({ to: '/decks' })
    snackbar.show({
      message: t('snackbar.deckDeleted'),
      actionLabel: t('common.undo'),
      onAction: () => undeleteDeck(deck.id),
      duration: DELETE_UNDO_MS,
    })
  }

  const isArchived = deck.archived_at !== null
  const selecting = selection !== null

  return (
    <div className={cn('mx-auto flex w-full max-w-[720px] flex-col pt-2', selecting && 'pb-24')}>
      {selecting ? (
        <header className="flex min-h-14 items-center gap-2 px-2">
          <Button variant="ghost" size="xl" onClick={() => setSelection(null)}>
            {t('deck.done')}
          </Button>
          <h1 className="flex-1 text-center text-lg font-semibold">{t('deck.selected', { count: selection.size })}</h1>
          <Button variant="ghost" size="xl" onClick={() => setSelection(new Set(visible.map((i) => i.card.id)))}>
            {t('deck.selectAll')}
          </Button>
        </header>
      ) : (
        <header className="flex min-h-14 items-center gap-1 px-2">
          <Button
            variant="ghost"
            size="icon-xl"
            aria-label={t('common.back')}
            onClick={() => (router.history.canGoBack() ? router.history.back() : navigate({ to: '/decks' }))}
          >
            <ChevronLeft className="size-6" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{deck.name}</h1>
            <p className="text-sm text-muted-foreground">
              {t('decks.languagePair', {
                target: languageTag(deck.target_lang),
                native: languageTag(deck.native_lang),
              })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-xl"
            aria-label={t('common.search')}
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((open) => !open)}
          >
            <Search className="size-5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xl" aria-label={t('deck.menu')}>
                <MoreHorizontal className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
              <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>{t('deck.settings')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSelection(new Set())}>{t('deck.select')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: '/import', search: { deck: deck.id } })}>
                {t('deck.import')}
              </DropdownMenuItem>
              {/* Deck CSV export arrives with P1-T06. */}
              <DropdownMenuItem disabled>{t('deck.export')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => (isArchived ? unarchiveDeck(deck.id) : archiveDeck(deck.id))}>
                {isArchived ? t('common.unarchive') : t('common.archive')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDeckDelete(true)}>
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
      )}

      {items.length === 0 ? (
        <EmptyState
          message={t('deck.empty')}
          actionLabel={t('deck.addWord')}
          onAction={() => navigate({ to: '/cards/new', search: { deck: deck.id } })}
        >
          <Button size="xl" variant="outline" onClick={() => navigate({ to: '/import', search: { deck: deck.id } })}>
            {t('deck.importCards')}
          </Button>
        </EmptyState>
      ) : (
        <>
          <fieldset aria-label={t('deck.filters.label')} className="grid grid-cols-4 gap-1 px-4 pt-2">
            {filters.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={filter === name}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center rounded-xl border text-xs',
                  filter === name ? 'border-primary bg-primary text-primary-foreground' : 'bg-card',
                )}
                onClick={() => setFilter((current) => (current === name ? null : name))}
              >
                <span className="text-lg font-semibold">{counts[name]}</span>
                <span>{t(`deck.filters.${name}`)}</span>
              </button>
            ))}
          </fieldset>

          <div className="grid grid-cols-2 gap-2 px-4 pt-3">
            <Button asChild size="xl">
              <Link to="/study" search={{ deck: deck.id }}>
                {t('deck.study')}
              </Link>
            </Button>
            <Button asChild size="xl" variant="secondary">
              <Link to="/study" search={{ deck: deck.id, practice: 1 }}>
                {t('deck.practice')}
              </Link>
            </Button>
          </div>

          {searchOpen && (
            <div className="px-4 pt-3">
              <Input
                type="search"
                autoFocus
                value={search}
                placeholder={t('deck.searchPlaceholder')}
                aria-label={t('deck.searchPlaceholder')}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          )}

          <div className="flex items-center gap-2 px-4 pt-3">
            <select
              aria-label={t('deck.sort.label')}
              className="h-11 rounded-lg border border-input bg-transparent px-3"
              value={sort}
              onChange={(event) => setSort(event.target.value as CardSort)}
            >
              {sorts.map((name) => (
                <option key={name} value={name}>
                  {t(`deck.sort.${name}`)}
                </option>
              ))}
            </select>
          </div>

          {tags.length > 0 && (
            <ul aria-label={t('deck.tags')} className="flex gap-1.5 overflow-x-auto px-4 pt-3 pb-1">
              {tags.map((name) => (
                <li key={name} className="shrink-0">
                  <button
                    type="button"
                    aria-pressed={tag === name}
                    className={cn(
                      'min-h-11 rounded-full border px-3 text-sm',
                      tag === name && 'border-primary bg-primary text-primary-foreground',
                    )}
                    onClick={() => setTag((current) => (current === name ? null : name))}
                  >
                    #{name}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-muted-foreground">{t('deck.noMatches')}</p>
          ) : (
            <CardList
              items={visible}
              selection={selection}
              onToggle={toggleSelected}
              onStartSelection={(id) => setSelection(new Set([id]))}
              onDelete={(id) => removeCards([id])}
            />
          )}
        </>
      )}

      {selection && (
        <BulkActions
          deck={deck}
          selected={[...selection]}
          onDelete={async (ids) => {
            setSelection(null)
            await removeCards(ids)
          }}
          onDone={() => setSelection(null)}
        />
      )}

      <DeckFormSheet mode="edit" deck={deck} open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ConfirmSheet
        open={confirmDeckDelete}
        onOpenChange={setConfirmDeckDelete}
        title={t('decks.deleteConfirm', { count: items.length })}
        description={`«${deck.name}» · ${t('decks.deleteHint')}`}
        confirmLabel={t('common.delete')}
        onConfirm={removeDeck}
      />
    </div>
  )
}

type CardListProps = {
  items: CardWithStates[]
  selection: Set<string> | null
  onToggle: (id: string) => void
  onStartSelection: (id: string) => void
  onDelete: (id: string) => void
}

/** Window-virtualized card list: only the rows on screen are rendered, so 5 000+ cards stay smooth. */
function CardList({ items, selection, onToggle, onStartSelection, onDelete }: CardListProps) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLUListElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)

  useLayoutEffect(() => {
    setScrollMargin(listRef.current?.offsetTop ?? 0)
  })

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin,
    getItemKey: (index) => items[index]?.card.id ?? index,
  })

  return (
    <ul
      ref={listRef}
      aria-label={t('deck.cardList')}
      className="relative mt-3"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const item = items[row.index]
        if (!item) return null
        return (
          <li
            key={row.key}
            className="absolute inset-x-0 top-0 border-b"
            style={{ height: ROW_HEIGHT, transform: `translateY(${row.start - scrollMargin}px)` }}
          >
            <CardRow
              item={item}
              selected={selection?.has(item.card.id) ?? null}
              onToggle={() => onToggle(item.card.id)}
              onLongPress={() => (selection ? onToggle(item.card.id) : onStartSelection(item.card.id))}
              onDelete={() => onDelete(item.card.id)}
            />
          </li>
        )
      })}
    </ul>
  )
}

type CardRowProps = {
  item: CardWithStates
  /** `null` outside selection mode. */
  selected: boolean | null
  onToggle: () => void
  onLongPress: () => void
  onDelete: () => void
}

function CardRow({ item, selected, onToggle, onLongPress, onDelete }: CardRowProps) {
  const { t, i18n } = useTranslation()
  const { card } = item
  const status = cardStatus(item)
  const due = nextDue(item)

  const content = (
    <>
      <span className={cn('size-2.5 shrink-0 rounded-full', statusDotClass[status])} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold">{card.front}</span>
        <span className="truncate text-sm text-muted-foreground">{card.back}</span>
      </span>
      <span className="sr-only">{t(`deck.filters.${status}`)}</span>
      {due !== null && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {t('deck.due', { when: relativeTime(due, i18n.language) })}
        </span>
      )}
    </>
  )

  if (selected !== null) {
    return (
      <SwipeRow onLongPress={onLongPress}>
        <button
          type="button"
          aria-pressed={selected}
          aria-label={t('deck.selectCard', { front: card.front })}
          className="flex h-[67px] w-full items-center gap-3 px-4 text-left"
          onClick={onToggle}
        >
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full border-2',
              selected && 'border-primary bg-primary text-primary-foreground',
            )}
          >
            {selected && <Check className="size-4" />}
          </span>
          {content}
        </button>
      </SwipeRow>
    )
  }

  return (
    <SwipeRow
      actionsWidth={SWIPE_ACTIONS_WIDTH}
      onLongPress={onLongPress}
      actions={(close) => (
        <button
          type="button"
          className="flex flex-1 flex-col items-center justify-center gap-1 bg-destructive text-sm text-white"
          onClick={() => {
            close()
            onDelete()
          }}
        >
          <Trash2 className="size-5" aria-hidden />
          {t('common.delete')}
        </button>
      )}
    >
      <Link
        to="/cards/$cardId"
        params={{ cardId: card.id }}
        draggable={false}
        className="flex h-[67px] min-w-0 flex-1 items-center gap-3 px-4"
      >
        {content}
      </Link>
    </SwipeRow>
  )
}
