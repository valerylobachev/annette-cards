import { Link } from '@tanstack/react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { findDuplicate } from '@/db/cards'
import { normalizeFront } from '@/domain/normalize'
import type { Card } from '@/domain/types'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'

export const DUPLICATE_CHECK_DELAY_MS = 300

/** The existing card with the same normalized front in the deck, checked 300 ms after typing stops. */
export function useDuplicate(deck_id: string, front: string, excludeId?: string): Card | undefined {
  const debouncedFront = useDebouncedValue(front, DUPLICATE_CHECK_DELAY_MS)
  const duplicate = useLiveQuery(
    async () => (deck_id ? findDuplicate(deck_id, debouncedFront, excludeId) : undefined),
    [deck_id, debouncedFront, excludeId],
  )
  // Ignore a result for text that has changed since (e.g. the field was just cleared after saving).
  return duplicate && normalizeFront(duplicate.front) === normalizeFront(front) ? duplicate : undefined
}

/** "Already in deck: *front — back*" with a link to the existing card (S-08). Saving is still allowed. */
export function DuplicateWarning({ card }: { card: Card }) {
  const { t } = useTranslation()
  return (
    <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400" role="status">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {t('cards.editor.duplicate')}{' '}
        <Link to="/cards/$cardId" params={{ cardId: card.id }} className="font-medium italic underline">
          {card.front} — {card.back}
        </Link>
      </span>
    </p>
  )
}
