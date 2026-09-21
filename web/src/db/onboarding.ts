import type { DeckInput } from '@/domain/deckValidation'
import { validateSettingsPatch } from '@/domain/settings'
import type { Deck, Settings } from '@/domain/types'
import { ValidationError } from '@/domain/validation'
import { insertDeck } from './decks'
import { getMeta } from './meta'
import { db } from './schema'
import { writeSettings } from './settings'
import { mutate } from './write'

/**
 * A new user on this device (S-01): no deck was ever created here (soft-deleted decks count, so someone who deleted
 * every deck is not new) and onboarding was not finished.
 */
export async function isFirstRun(): Promise<boolean> {
  if (await getMeta('onboarding_done')) return false
  return (await db.decks.count()) === 0
}

/** Finishes onboarding in one transaction: the settings chosen, the first deck and `meta.onboarding_done`. */
export function completeOnboarding(settings: Partial<Settings>, deck: DeckInput): Promise<Deck> {
  const errors = validateSettingsPatch(settings)
  if (errors.length > 0) return Promise.reject(new ValidationError(errors))
  return mutate(['decks', 'settings', 'meta'], async (ctx) => {
    await writeSettings(ctx, settings)
    const created = await insertDeck(ctx, deck)
    await ctx.db.meta.put({ key: 'onboarding_done', value: true })
    return created
  })
}
