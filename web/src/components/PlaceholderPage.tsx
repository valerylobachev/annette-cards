import { useRouter } from '@tanstack/react-router'
import type { ParseKeys } from 'i18next'
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

type Props = {
  titleKey: ParseKeys
  /** Show a back chevron (screens that are not tabs). */
  back?: boolean
  children?: ReactNode
}

/** Temporary screen body used until the feature task builds the real screen. */
export function PlaceholderPage({ titleKey, back = false, children }: Props) {
  const { t } = useTranslation()
  const router = useRouter()

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pt-4">
      <header className="flex min-h-11 items-center gap-2">
        {back && (
          <Button variant="ghost" size="icon-lg" aria-label={t('common.back')} onClick={() => router.history.back()}>
            <ChevronLeft className="size-6" />
          </Button>
        )}
        <h1 className="text-2xl font-semibold">{t(titleKey)}</h1>
      </header>
      <p className="text-muted-foreground">{t('common.comingSoon')}</p>
      {children}
    </div>
  )
}
