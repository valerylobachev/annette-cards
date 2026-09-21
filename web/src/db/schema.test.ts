import { afterEach, describe, expect, it } from 'vitest'
import { createDb } from './schema'

const testDb = createDb('schema-test')

afterEach(async () => {
  await testDb.delete()
})

describe('schema v1', () => {
  it('creates all seven tables', async () => {
    await testDb.open()
    expect(testDb.tables.map((table) => table.name).sort()).toEqual([
      'card_states',
      'cards',
      'decks',
      'meta',
      'outbox',
      'review_log',
      'settings',
    ])
    expect(testDb.verno).toBe(1)
  })
})
