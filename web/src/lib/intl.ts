// Locale-aware formatting in the UI language (ui_ux.md §9). Pass `i18n.language` as `uiLocale`.

/** Name of a language in the UI language, e.g. `pl` → "польский" in `ru`, "Polish" in `en`. */
export function languageName(code: string, uiLocale: string): string {
  try {
    return new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600 * 1000],
  ['month', 30 * 24 * 3600 * 1000],
  ['week', 7 * 24 * 3600 * 1000],
  ['day', 24 * 3600 * 1000],
  ['hour', 3600 * 1000],
  ['minute', 60 * 1000],
]

/** `timestamp` relative to `now`, e.g. "in 3 days" / "через 3 дня", "5 minutes ago". */
export function relativeTime(timestamp: number, uiLocale: string, now: number = Date.now()): string {
  const diff = timestamp - now
  const format = new Intl.RelativeTimeFormat(uiLocale, { numeric: 'auto' })
  for (const [unit, ms] of units) {
    if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit)
  }
  return format.format(0, 'minute')
}

export function formatNumber(value: number, uiLocale: string): string {
  return new Intl.NumberFormat(uiLocale).format(value)
}

/** Short tag of a BCP-47 code for compact labels: `en-GB` → "EN-GB", `ru` → "RU". */
export function languageTag(code: string): string {
  return code.toUpperCase()
}

/** A duration as "4 min" / "4 мин", or seconds below one minute ("45 sec" / "45 с"). */
export function formatDuration(ms: number, uiLocale: string): string {
  const seconds = Math.round(ms / 1000)
  const [value, unit] = seconds < 60 ? [seconds, 'second'] : [Math.round(seconds / 60), 'minute']
  return new Intl.NumberFormat(uiLocale, { style: 'unit', unit, unitDisplay: 'short' }).format(value)
}

export function formatPercent(share: number, uiLocale: string): string {
  return new Intl.NumberFormat(uiLocale, { style: 'percent', maximumFractionDigits: 0 }).format(share)
}
