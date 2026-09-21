import { useTranslation } from 'react-i18next'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'

/** Common IPA symbols for English and Polish transcriptions (S-08). */
export const IPA_SYMBOLS = ['ə', 'ɪ', 'ʊ', 'ɛ', 'æ', 'ɑ', 'ɔ', 'ʌ', 'θ', 'ð', 'ʃ', 'ʒ', 'ŋ', 'ː', 'ˈ', 'ˌ']

/** A row of IPA symbol keys shown above the on-screen keyboard while the IPA field is focused. */
export function IpaHelperRow({ onInsert }: { onInsert: (symbol: string) => void }) {
  const { t } = useTranslation()
  const keyboardInset = useKeyboardInset()

  return (
    <div
      role="toolbar"
      aria-label={t('cards.editor.ipaSymbols')}
      className="fixed inset-x-0 z-40 flex gap-1 overflow-x-auto border-t bg-muted px-2 py-1"
      style={{ bottom: keyboardInset }}
    >
      {IPA_SYMBOLS.map((symbol) => (
        <button
          key={symbol}
          type="button"
          className="min-h-11 min-w-11 shrink-0 rounded-md bg-background text-lg shadow-sm"
          aria-label={t('cards.editor.insertSymbol', { symbol })}
          // Keep the focus (and the keyboard) in the IPA field.
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onInsert(symbol)}
        >
          {symbol}
        </button>
      ))}
    </div>
  )
}
