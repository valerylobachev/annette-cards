import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

type Props = { label: string; value: string; lang?: string; onAccept: () => void }

/** An AI suggestion under an editor field (S-08): muted text with a ✓ that puts it into the field. */
export function SuggestionGhost({ label, value, lang, onAccept }: Props) {
  const { t } = useTranslation()
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-dashed pl-3 text-muted-foreground"
      data-testid="suggestion"
    >
      <p lang={lang} className="min-w-0 flex-1 py-2 break-words whitespace-pre-wrap">
        <span className="sr-only">{t('enrich.suggestionFor', { field: label })} </span>
        {value}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-xl"
        aria-label={t('enrich.acceptField', { field: label })}
        onClick={onAccept}
      >
        <Check className="size-5" />
      </Button>
    </div>
  )
}
