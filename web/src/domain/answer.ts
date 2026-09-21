import { normalizeFront } from './normalize'
import type { Card, Deck, Direction } from './types'

/** Punctuation stripped from both ends of a typed answer (architecture.md §4.4). */
const SURROUNDING_PUNCTUATION = /^[.,!?;:"'«»()\s]+|[.,!?;:"'«»()\s]+$/g
/** One leading article or particle dropped from English answers: "to take off" = "take off". */
export const ENGLISH_LEADING_WORDS = ['to', 'the', 'a']
/** Letters that do not decompose into a base letter and a combining mark. */
const UNDECOMPOSABLE: Record<string, string> = { ł: 'l', Ł: 'L', ø: 'o', Ø: 'O', đ: 'd', Đ: 'D' }

/**
 * Canonical form of a typed answer: `normalizeFront` (NFC, trim, lowercase, one space between words), surrounding
 * punctuation removed and, when `ignoreLeading` lists it, one leading article or particle dropped.
 */
export function normalizeAnswer(text: string, opts: { ignoreLeading?: string[] } = {}): string {
  const plain = normalizeFront(text).replace(SURROUNDING_PUNCTUATION, '')
  const [first, ...rest] = plain.split(' ')
  if (rest.length > 0 && first !== undefined && opts.ignoreLeading?.includes(first)) return rest.join(' ')
  return plain
}

/** The text without accents and other diacritics: `żółw` → `zolw`, `łódź` → `lodz`. */
export function stripDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[łŁøØđĐ]/g, (letter) => UNDECOMPOSABLE[letter] ?? letter)
    .normalize('NFC')
}

/**
 * A table of edit distances between the first `i` letters of one text and the first `j` of another; row 0 and
 * column 0 hold the cost of typing or deleting everything.
 */
function distanceTable(rows: number, cols: number) {
  const cells = Array.from({ length: (rows + 1) * (cols + 1) }, (_, k) => {
    const i = Math.floor(k / (cols + 1))
    const j = k % (cols + 1)
    return i === 0 ? j : j === 0 ? i : 0
  })
  return {
    get: (i: number, j: number) => cells[i * (cols + 1) + j] ?? 0,
    set: (i: number, j: number, value: number) => {
      cells[i * (cols + 1) + j] = value
    },
  }
}

/** Edit distance where an adjacent transposition counts as one edit (optimal string alignment). */
export function damerauLevenshtein(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  const d = distanceTable(x.length, y.length)
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      let best = Math.min(d.get(i - 1, j) + 1, d.get(i, j - 1) + 1, d.get(i - 1, j - 1) + cost)
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1])
        best = Math.min(best, d.get(i - 2, j - 2) + 1)
      d.set(i, j, best)
    }
  }
  return d.get(x.length, y.length)
}

export type TypedVerdict = 'exact' | 'near' | 'wrong'

/**
 * One piece of the correction shown after a near miss: `same` letters typed right, `missing` letters not typed,
 * `extra` letters typed but not expected, `diacritic` the correct letter where it was typed without its mark.
 */
export type DiffSegment = { kind: 'same' | 'missing' | 'extra' | 'diacritic'; text: string }

export type TypedResult = {
  verdict: TypedVerdict
  /** The expected answer that matched (as written on the card), `null` for a wrong answer. */
  matched: string | null
  diff: DiffSegment[]
}

/** Near miss allows one edit in answers up to 6 letters and two in longer ones. */
function nearMissLimit(expected: string): number {
  return Array.from(expected).length <= 6 ? 1 : 2
}

/** Articles are dropped only in English answers. */
function leadingWordsFor(lang: string): string[] {
  return lang.toLowerCase().split('-')[0] === 'en' ? ENGLISH_LEADING_WORDS : []
}

/**
 * Checks a typed answer against the accepted answers (architecture.md §4.4): equal after normalization is exact;
 * within the edit limit of the normalized expected answer, or equal once diacritics are stripped, is a near miss
 * (the closest answer wins); anything else is wrong. `lang` is the language the answer is typed in.
 */
export function checkTypedAnswer(expected: string[], given: string, lang: string): TypedResult {
  const ignoreLeading = leadingWordsFor(lang)
  const typed = normalizeAnswer(given, { ignoreLeading })
  const wrong: TypedResult = { verdict: 'wrong', matched: null, diff: [] }
  if (typed === '') return wrong

  const candidates = expected
    .map((answer) => ({ answer, normalized: normalizeAnswer(answer, { ignoreLeading }) }))
    .filter(({ normalized }) => normalized !== '')
  const exact = candidates.find(({ normalized }) => normalized === typed)
  if (exact) return { verdict: 'exact', matched: exact.answer, diff: [{ kind: 'same', text: exact.normalized }] }

  const near = candidates
    .map((candidate) => ({ ...candidate, distance: damerauLevenshtein(typed, candidate.normalized) }))
    .filter(
      ({ normalized, distance }) =>
        distance <= nearMissLimit(normalized) || stripDiacritics(normalized) === stripDiacritics(typed),
    )
    .sort((a, b) => a.distance - b.distance)[0]
  if (!near) return wrong
  return { verdict: 'near', matched: near.answer, diff: diffAnswer(near.normalized, typed) }
}

/**
 * The correction of a typed answer letter by letter: an alignment (edit distance with a back-trace) where a letter
 * typed without its diacritic is a cheaper substitution than a different letter.
 */
export function diffAnswer(expected: string, typed: string): DiffSegment[] {
  const x = Array.from(typed)
  const y = Array.from(expected)
  const letter = (letters: string[], index: number) => letters[index - 1] ?? ''
  const substitution = (i: number, j: number) => {
    const a = letter(x, i)
    const b = letter(y, j)
    return a === b ? 0 : stripDiacritics(a) === stripDiacritics(b) ? 0.5 : 1
  }
  const d = distanceTable(x.length, y.length)
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      d.set(i, j, Math.min(d.get(i - 1, j) + 1, d.get(i, j - 1) + 1, d.get(i - 1, j - 1) + substitution(i, j)))
    }
  }

  const reversed: DiffSegment[] = []
  let i = x.length
  let j = y.length
  while (i > 0 || j > 0) {
    const cost = i > 0 && j > 0 ? substitution(i, j) : Number.POSITIVE_INFINITY
    if (d.get(i, j) === d.get(i - 1, j - 1) + cost) {
      if (cost === 0) reversed.push({ kind: 'same', text: letter(y, j) })
      else if (cost === 0.5) reversed.push({ kind: 'diacritic', text: letter(y, j) })
      else reversed.push({ kind: 'missing', text: letter(y, j) }, { kind: 'extra', text: letter(x, i) })
      i--
      j--
    } else if (j > 0 && d.get(i, j) === d.get(i, j - 1) + 1) {
      reversed.push({ kind: 'missing', text: letter(y, j) })
      j--
    } else {
      reversed.push({ kind: 'extra', text: letter(x, i) })
      i--
    }
  }
  return mergeSegments(reversed.reverse())
}

function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = []
  for (const segment of segments) {
    const last = merged.at(-1)
    if (last?.kind === segment.kind) last.text += segment.text
    else merged.push({ ...segment })
  }
  return merged
}

/**
 * Answers accepted in typing mode (ui_ux.md S-11 Mode D): the studied word when the prompt is the translation
 * (reverse); any `;`-separated meaning of the translation when the prompt is the studied word (forward).
 */
export function expectedAnswers(card: Pick<Card, 'front' | 'back'>, direction: Direction): string[] {
  if (direction === 'reverse') return [card.front]
  return card.back
    .split(';')
    .map((meaning) => meaning.trim())
    .filter((meaning) => meaning !== '')
}

/** The language an answer is typed in: the studied language for reverse, the native one for forward. */
export function answerLang(deck: Pick<Deck, 'target_lang' | 'native_lang'>, direction: Direction): string {
  return direction === 'reverse' ? deck.target_lang : deck.native_lang
}
