import type { CardDto, CardStateDto, Changes, DeckDto, ReviewLogDto, SettingsDto } from '@/api/model'
import type { OutboxRow, RemoteChanges } from '@/db/remote'
import type { SettingsRow } from '@/db/schema'
import type { Card, CardState, CardStateSnapshot, Deck, FsrsState, Rating, ReviewLog } from '@/domain/types'

// Payload rows are the Dexie rows (architecture.md §6.3), except that the server may omit `null` fields and that
// the settings row travels as `{ data, updated_at, updated_by }`.

export function deckFromDto(dto: DeckDto): Deck {
  return {
    ...dto,
    new_per_day: dto.new_per_day ?? null,
    archived_at: dto.archived_at ?? null,
    deleted_at: dto.deleted_at ?? null,
  }
}

export function cardFromDto(dto: CardDto): Card {
  return {
    ...dto,
    example: dto.example ?? null,
    example_translation: dto.example_translation ?? null,
    ipa: dto.ipa ?? null,
    notes: dto.notes ?? null,
    audio_id: dto.audio_id ?? null,
    deleted_at: dto.deleted_at ?? null,
  }
}

export function cardStateFromDto(dto: CardStateDto): CardState {
  return {
    ...dto,
    state: dto.state as FsrsState,
    last_review: dto.last_review ?? null,
    deleted_at: dto.deleted_at ?? null,
  }
}

export function reviewLogFromDto(dto: ReviewLogDto): ReviewLog {
  return {
    ...dto,
    rating: dto.rating as Rating,
    state_before: dto.state_before as CardStateSnapshot,
    deleted_at: dto.deleted_at ?? null,
  }
}

export function settingsFromDto(dto: SettingsDto): SettingsRow {
  const data = typeof dto.data === 'object' && dto.data !== null ? dto.data : {}
  return { ...data, id: 'user', updated_at: dto.updated_at, updated_by: dto.updated_by }
}

export function settingsToDto(row: SettingsRow): SettingsDto {
  const { id: _id, updated_at, updated_by, ...data } = row
  return { data, updated_at, updated_by }
}

export function remoteChanges(changes: Changes): RemoteChanges {
  return {
    decks: (changes.decks ?? []).map(deckFromDto),
    cards: (changes.cards ?? []).map(cardFromDto),
    card_states: (changes.card_states ?? []).map(cardStateFromDto),
    review_log: (changes.review_log ?? []).map(reviewLogFromDto),
    settings: changes.settings ? settingsFromDto(changes.settings) : null,
  }
}

/** Order in which the server applies entities; batches follow it so that parents are pushed before children. */
export const ENTITY_ORDER = ['decks', 'cards', 'card_states', 'review_log', 'settings'] as const

/** Push `changes` for outbox rows. */
export function pushChanges(rows: OutboxRow[]): Changes {
  const changes: Required<Changes> = { decks: [], cards: [], card_states: [], review_log: [], settings: null }
  for (const item of rows) {
    switch (item.entity) {
      case 'decks':
        changes.decks.push(item.row)
        break
      case 'cards':
        changes.cards.push(item.row)
        break
      case 'card_states':
        changes.card_states.push(item.row)
        break
      case 'review_log':
        changes.review_log.push(item.row)
        break
      case 'settings':
        changes.settings = settingsToDto(item.row)
        break
    }
  }
  return changes
}
