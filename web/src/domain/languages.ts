/** Study languages shown first, with their locale variants (ui_ux.md S-01, S-05). BCP-47 tags. */
export const PINNED_STUDY_LANGUAGES = ['en-GB', 'en-US', 'pl-PL'] as const

/** Further study languages offered in the "Other language" picker. */
export const OTHER_STUDY_LANGUAGES = [
  'de-DE',
  'fr-FR',
  'es-ES',
  'it-IT',
  'pt-PT',
  'pt-BR',
  'nl-NL',
  'sv-SE',
  'cs-CZ',
  'uk-UA',
  'tr-TR',
  'ja-JP',
  'ko-KR',
  'zh-CN',
] as const

/** Languages cards are translated into; Russian is the default (CLAUDE.md). */
export const NATIVE_LANGUAGES = ['ru', 'en', 'uk', 'pl', 'de', 'fr', 'es'] as const
export const DEFAULT_NATIVE_LANGUAGE = 'ru'
