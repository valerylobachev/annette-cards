import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import ru from './ru.json'

export const uiLanguages = ['en', 'ru'] as const
export type UiLanguage = (typeof uiLanguages)[number]

export const resources = { en: { translation: en }, ru: { translation: ru } } as const

/** Architecture §4.6: a language starting with `ru` → Russian, anything else → English. */
export function toUiLanguage(language: string | undefined): UiLanguage {
  return language?.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: uiLanguages,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      // Stored choice first (moves to the settings document in P1-T12), then the browser language.
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'annette.uiLanguage',
      caches: ['localStorage'],
      convertDetectedLanguage: toUiLanguage,
    },
  })

i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language
})
document.documentElement.lang = i18n.language

export default i18n
