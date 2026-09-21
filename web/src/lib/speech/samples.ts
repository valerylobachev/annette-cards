import { languageName } from '@/lib/intl'

// Voice samples (S-16) are content in the studied language, not UI text, so they are not translated.
const SAMPLES: Record<string, string> = {
  en: 'The quick brown fox jumps over the lazy dog.',
  pl: 'Zażółć gęślą jaźń.',
}

/** A sample sentence for a studied language; other languages say their own name ("Deutsch", "français"). */
export function sampleText(lang: string): string {
  const primary = lang.split(/[-_]/)[0]?.toLowerCase() ?? lang
  return SAMPLES[primary] ?? languageName(primary, primary)
}
