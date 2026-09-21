import { describe, expect, it } from 'vitest'
import en from './en.json'
import i18n, { toUiLanguage } from './index'
import ru from './ru.json'

function keys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === 'object' && child !== null ? keys(child, `${prefix}${key}.`) : [`${prefix}${key}`],
  )
}

/** Plural suffixes differ between languages (`_few`, `_many` exist only in Russian). */
function withoutPluralSuffix(key: string): string {
  return key.replace(/_(zero|one|two|few|many|other)$/, '')
}

describe('i18n', () => {
  it('has the same keys in en.json and ru.json', () => {
    const enKeys = new Set(keys(en).map(withoutPluralSuffix))
    const ruKeys = new Set(keys(ru).map(withoutPluralSuffix))
    expect([...ruKeys].sort()).toEqual([...enKeys].sort())
  })

  it('has every plural form: one/other in English, one/few/many/other in Russian', () => {
    const plurals = (all: string[]) =>
      new Set(all.filter((key) => key !== withoutPluralSuffix(key)).map(withoutPluralSuffix))
    const enKeys = keys(en)
    const ruKeys = keys(ru)
    const missing = (all: string[], base: string, forms: string[]) =>
      forms.map((form) => `${base}_${form}`).filter((key) => !all.includes(key))
    for (const base of new Set([...plurals(enKeys), ...plurals(ruKeys)])) {
      expect(missing(enKeys, base, ['one', 'other']), `en ${base}`).toEqual([])
      expect(missing(ruKeys, base, ['one', 'few', 'many', 'other']), `ru ${base}`).toEqual([])
    }
  })

  it('uses Russian plural forms for 1, 2 and 5', () => {
    const t = i18n.getFixedT('ru')
    expect(t('cards.count', { count: 1 })).toBe('1 карточка')
    expect(t('cards.count', { count: 2 })).toBe('2 карточки')
    expect(t('cards.count', { count: 5 })).toBe('5 карточек')
    expect(t('cards.count', { count: 21 })).toBe('21 карточка')
  })

  it('uses English plural forms', () => {
    const t = i18n.getFixedT('en')
    expect(t('cards.count', { count: 1 })).toBe('1 card')
    expect(t('cards.count', { count: 5 })).toBe('5 cards')
  })

  it('maps browser languages to a UI language', () => {
    expect(toUiLanguage('ru-RU')).toBe('ru')
    expect(toUiLanguage('ru')).toBe('ru')
    expect(toUiLanguage('en-GB')).toBe('en')
    expect(toUiLanguage('pl-PL')).toBe('en')
    expect(toUiLanguage(undefined)).toBe('en')
  })
})
