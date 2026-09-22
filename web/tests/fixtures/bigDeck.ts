/**
 * Deterministic data for the 10 000-card performance pass (P4-T06): an import CSV (README "Import format") and the
 * rows of a studied deck (cards, both directions' states, a year of review logs) to seed IndexedDB with. No Node
 * imports: the Playwright specs load this module in the page from the Vite dev server.
 */

export const BIG_DECK_SIZE = 10_000
const DAY = 86_400_000

const SYLLABLES = ['ka', 'lo', 'mi', 'ne', 'ru', 'sta', 'pe', 'bo', 'di', 'tu', 'gra', 'vel', 'shi', 'mor', 'zan', 'fi']

/**
 * A unique made-up word per index: the index in base 16 with a syllable per digit, at least two (no syllable is the
 * start of another, so different indexes never spell the same word).
 */
export function wordOf(index: number): string {
  let rest = index
  let word = ''
  let digits = 0
  do {
    word += SYLLABLES[rest % SYLLABLES.length]
    rest = Math.floor(rest / SYLLABLES.length)
    digits++
  } while (rest > 0 || digits < 2)
  return word
}

/** A tiny deterministic generator (the same data on every run). */
function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
}

const quote = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)

/** `rows` data rows with a header; every tenth has an example, IPA, tags and notes. */
export function generateCsv(rows: number = BIG_DECK_SIZE): string {
  const lines = ['front,back,example,example_translation,ipa,tags,notes']
  for (let i = 0; i < rows; i++) {
    const word = wordOf(i)
    const rich = i % 10 === 0
    const cells = [
      word,
      `перевод ${i}; значение ${i % 97}`,
      rich ? `The ${word} is on the table.` : '',
      rich ? `${word} на столе.` : '',
      rich ? `/${word}/` : '',
      rich ? `generated batch-${i % 20}` : '',
      rich ? 'noun, "made up"' : '',
    ]
    lines.push(cells.map(quote).join(','))
  }
  return `${lines.join('\n')}\n`
}

const stamp = { updated_at: 1, updated_by: 'perf', deleted_at: null }

export type StudyRows = {
  decks: Record<string, unknown>[]
  cards: Record<string, unknown>[]
  card_states: Record<string, unknown>[]
  review_log: Record<string, unknown>[]
}

/**
 * One deck of `cards` cards studied in both directions at `now`: about half of the states New, a few Learning, the
 * rest Review with due dates from a month ago to two months ahead, and `logs` answers over the last year.
 */
export function generateStudyData({
  cards = BIG_DECK_SIZE,
  logs = 100_000,
  now,
  deckId = 'big-deck',
}: {
  cards?: number
  logs?: number
  now: number
  deckId?: string
}): StudyRows {
  const next = random(cards + logs)
  const cardRows: Record<string, unknown>[] = []
  const states: Record<string, unknown>[] = []
  for (let i = 0; i < cards; i++) {
    const id = `card-${String(i).padStart(6, '0')}`
    cardRows.push({
      id,
      deck_id: deckId,
      front: wordOf(i),
      back: `перевод ${i}`,
      example: null,
      example_translation: null,
      ipa: null,
      tags: i % 10 === 0 ? ['generated'] : [],
      notes: null,
      audio_id: null,
      created_at: now - 400 * DAY + i,
      ...stamp,
    })
    for (const direction of ['forward', 'reverse']) {
      const roll = next()
      const state = roll < 0.5 ? 0 : roll < 0.55 ? 1 : 2
      const due = state === 0 ? now - 400 * DAY : now + Math.round((next() * 90 - 30) * DAY)
      states.push({
        card_id: id,
        direction,
        state,
        due,
        stability: state === 0 ? 0 : 1 + next() * 60,
        difficulty: state === 0 ? 0 : 1 + next() * 9,
        elapsed_days: 0,
        scheduled_days: state === 2 ? Math.round(next() * 60) : 0,
        learning_steps: 0,
        reps: state === 0 ? 0 : 1 + Math.floor(next() * 10),
        lapses: 0,
        last_review: state === 0 ? null : due - 10 * DAY,
        ...stamp,
      })
    }
  }
  const logRows: Record<string, unknown>[] = []
  for (let i = 0; i < logs; i++) {
    const card = Math.floor(next() * cards)
    logRows.push({
      id: `log-${String(i).padStart(7, '0')}`,
      card_id: `card-${String(card).padStart(6, '0')}`,
      direction: next() < 0.5 ? 'forward' : 'reverse',
      rating: 1 + Math.floor(next() * 4),
      mode: 'swipe',
      state_before: {
        state: 2,
        due: 0,
        stability: 5,
        difficulty: 5,
        elapsed_days: 3,
        scheduled_days: 3,
        learning_steps: 0,
        reps: 3,
        lapses: 0,
        last_review: 0,
      },
      // Spread over the last year, none today (so the daily limits are untouched).
      reviewed_at: now - DAY - Math.floor(next() * 364 * DAY),
      duration_ms: 3_000 + Math.floor(next() * 10_000),
      practice: false,
      ...stamp,
    })
  }
  const deck = {
    id: deckId,
    name: 'Big deck',
    target_lang: 'en-GB',
    native_lang: 'ru',
    directions: 'both',
    new_per_day: null,
    archived_at: null,
    created_at: now - 400 * DAY,
    ...stamp,
  }
  return { decks: [deck], cards: cardRows, card_states: states, review_log: logRows }
}
