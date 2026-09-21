import { describe, expect, it } from 'vitest'
import { newCardState } from '../directions'
import { DEFAULT_SETTINGS } from '../settings'
import type { Card, Deck, ReviewLog } from '../types'
import { BACKUP_FORMAT, type BackupV1, backupFilename, parseBackup } from './format'
import { remapIds } from './regenerate'

const stamp = { updated_at: 1, updated_by: 'device', deleted_at: null }

function sampleBackup(): BackupV1 {
  const deck: Deck = {
    id: 'deck-1',
    name: 'English',
    target_lang: 'en-GB',
    native_lang: 'ru',
    directions: 'both',
    new_per_day: null,
    archived_at: null,
    created_at: 1,
    ...stamp,
  }
  const cards: Card[] = ['card-1', 'card-2'].map((id, i) => ({
    id,
    deck_id: deck.id,
    front: `word ${i}`,
    back: `слово ${i}`,
    example: null,
    example_translation: null,
    ipa: null,
    tags: [],
    notes: null,
    audio_id: null,
    created_at: 1,
    ...stamp,
  }))
  const states = cards.flatMap((card) => [newCardState(card.id, 'forward', 1), newCardState(card.id, 'reverse', 1)])
  const {
    card_id: _c,
    direction: _d,
    updated_at: _u,
    updated_by: _b,
    deleted_at: _x,
    ...snapshot
  } = newCardState('x', 'forward', 1)
  const logs: ReviewLog[] = cards.map((card, i) => ({
    id: `log-${i}`,
    card_id: card.id,
    direction: 'forward',
    rating: 3,
    mode: 'swipe',
    state_before: { ...snapshot },
    reviewed_at: 5,
    duration_ms: 1000,
    practice: false,
    ...stamp,
  }))
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exported_at: 10,
    app_version: '0.1.0',
    decks: [deck],
    cards,
    card_states: states,
    review_log: logs,
    settings: DEFAULT_SETTINGS,
  }
}

describe('parseBackup', () => {
  it('accepts a V1 backup', () => {
    const backup = sampleBackup()
    expect(parseBackup(JSON.parse(JSON.stringify(backup)))).toEqual({ ok: true, backup })
  })

  it('rejects a wrong format marker', () => {
    expect(parseBackup({ ...sampleBackup(), format: 'anki' })).toEqual({ ok: false, code: 'invalid_format' })
    expect(parseBackup('text')).toEqual({ ok: false, code: 'invalid_format' })
  })

  it('rejects version 2 with the version of the app that wrote it', () => {
    expect(parseBackup({ ...sampleBackup(), version: 2, app_version: '2.3.0' })).toEqual({
      ok: false,
      code: 'unsupported_version',
      required_version: '2.3.0',
    })
  })

  it('rejects rows that point outside the backup', () => {
    const backup = sampleBackup()
    const orphan = { ...backup, cards: [{ ...(backup.cards[0] as Card), deck_id: 'missing' }] }
    expect(parseBackup(orphan)).toEqual({ ok: false, code: 'invalid_format' })
  })
})

describe('remapIds', () => {
  it('gives new ids and keeps two states per card and every log on its card', () => {
    const backup = sampleBackup()
    let counter = 0
    const result = remapIds(backup, () => `new-${counter++}`)

    const oldIds = [
      ...backup.decks.map((d) => d.id),
      ...backup.cards.map((c) => c.id),
      ...backup.review_log.map((l) => l.id),
    ]
    const text = JSON.stringify(result)
    for (const id of oldIds) expect(text).not.toContain(`"${id}"`)

    const cardIds = new Set(result.cards.map((card) => card.id))
    expect(result.cards.every((card) => card.deck_id === result.decks[0]?.id)).toBe(true)
    for (const id of cardIds) {
      expect(result.card_states.filter((state) => state.card_id === id).map((s) => s.direction)).toEqual([
        'forward',
        'reverse',
      ])
    }
    expect(result.review_log.every((log) => cardIds.has(log.card_id))).toBe(true)
    expect(result.review_log.map((log) => log.card_id)).toEqual(result.cards.map((card) => card.id))
  })
})

describe('backupFilename', () => {
  it('uses the local date', () => {
    expect(backupFilename(new Date(2026, 0, 5, 23, 30))).toBe('annette-backup-2026-01-05.json')
  })
})
