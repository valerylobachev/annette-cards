import { X } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { cleanTags } from '@/domain/cardValidation'

type Props = {
  id: string
  value: string[]
  onChange: (tags: string[]) => void
  /** Existing tags for autocomplete. */
  suggestions: string[]
  invalid?: boolean
}

const MAX_SUGGESTIONS = 8

/** Tag chips with a text field; Enter or comma adds a tag, suggestions come from existing tags. */
export function TagInput({ id, value, onChange, suggestions, invalid }: Props) {
  const { t } = useTranslation()
  const [text, setText] = useState('')

  const needle = text.trim().toLowerCase()
  const selected = new Set(value.map((tag) => tag.toLowerCase()))
  const matches = needle
    ? suggestions
        .filter((tag) => !selected.has(tag.toLowerCase()) && tag.toLowerCase().includes(needle))
        .slice(0, MAX_SUGGESTIONS)
    : []

  function add(tag: string) {
    onChange(cleanTags([...value, tag]))
    setText('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.key === 'Enter' || event.key === ',') && text.trim() !== '') {
      event.preventDefault()
      add(text)
    } else if (event.key === 'Enter') {
      // An empty tag field must not submit the form.
      event.preventDefault()
    } else if (event.key === 'Backspace' && text === '' && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                className="flex min-h-11 items-center gap-1 rounded-full bg-secondary px-3 text-sm"
                aria-label={t('cards.editor.removeTag', { tag })}
                onClick={() => onChange(value.filter((other) => other !== tag))}
              >
                {tag}
                <X className="size-4 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        value={text}
        autoCapitalize="none"
        autoComplete="off"
        placeholder={t('cards.editor.tagsPlaceholder')}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          const next = event.target.value
          // A typed comma finishes a tag even when keydown is not reliable (iOS predictive text).
          if (next.endsWith(',') && next.trim() !== ',') add(next.slice(0, -1))
          else setText(next)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => text.trim() !== '' && add(text)}
      />
      {matches.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('cards.editor.tagSuggestions')}>
          {matches.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                className="min-h-11 rounded-full border px-3 text-sm"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => add(tag)}
              >
                {tag}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
