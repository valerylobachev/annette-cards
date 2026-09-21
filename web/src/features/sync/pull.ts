import { pull } from '@/api/endpoints/sync/sync'
import { getMeta } from '@/db/meta'
import { applyRemoteChanges } from '@/db/remote'
import { callApi } from '@/lib/api'
import { remoteChanges } from './convert'

export const PULL_PAGE = 500

/** Rows in a pulled page, for progress. */
function rowCount(changes: ReturnType<typeof remoteChanges>): number {
  return (
    changes.decks.length +
    changes.cards.length +
    changes.card_states.length +
    changes.review_log.length +
    (changes.settings ? 1 : 0)
  )
}

/**
 * Pulls pages after the saved cursor until the server has no more; each page is merged and its cursor saved in one
 * transaction, so an interrupted pull resumes where it stopped. Returns the number of pulled rows; `onPage` reports
 * the running total.
 */
export async function pullAll(onPage?: (pulled: number) => void): Promise<number> {
  let cursor = (await getMeta('sync_cursor')) ?? 0
  let pulled = 0
  for (;;) {
    const page = await callApi(() => pull({ cursor, limit: PULL_PAGE }))
    const changes = remoteChanges(page.changes)
    await applyRemoteChanges(changes, page.cursor)
    pulled += rowCount(changes)
    cursor = page.cursor
    onPage?.(pulled)
    if (!page.has_more) return pulled
  }
}
