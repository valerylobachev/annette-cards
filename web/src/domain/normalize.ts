/**
 * Canonical form of a card front for duplicate detection (decision D10): Unicode NFC, trimmed, lowercase, internal
 * whitespace collapsed to one space. Used by the card editor, quick add and CSV import.
 */
export function normalizeFront(front: string): string {
  return front.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ')
}
