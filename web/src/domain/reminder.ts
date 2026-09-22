/**
 * The study reminder notification (UC-23). The server pushes data only (`{ "type": "reminder", "due": 18 }`); the
 * service worker writes the text in the UI language from the bundled `notifications.reminder` strings.
 */

/** `notifications.reminder` of en.json / ru.json: i18next-style plural keys of the body. */
export type ReminderStrings = {
  title: string
  body_one?: string
  body_few?: string
  body_many?: string
  body_other: string
}

export type ReminderPayload = { type: 'reminder'; due: number }

/** The payload of a reminder push, or `null` for anything else. */
export function parseReminderPayload(data: unknown): ReminderPayload | null {
  if (typeof data !== 'object' || data === null) return null
  const { type, due } = data as Record<string, unknown>
  if (type !== 'reminder' || typeof due !== 'number' || !Number.isInteger(due) || due < 0) return null
  return { type, due }
}

/** Title and body for `due` words, with the plural form of `language` (`Intl.PluralRules`, like i18next). */
export function reminderNotification(
  due: number,
  language: string,
  strings: ReminderStrings,
): { title: string; body: string } {
  const category = new Intl.PluralRules(language).select(due)
  const template = strings[`body_${category}` as keyof ReminderStrings] ?? strings.body_other
  const count = new Intl.NumberFormat(language).format(due)
  return { title: strings.title, body: template.replaceAll('{{count}}', count) }
}
