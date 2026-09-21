import { Share, SquarePlus } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useMeta } from '@/db/hooks'
import { setMeta } from '@/db/meta'
import { isIosSafari, isStandalone } from '@/lib/platform'
import { cn } from '@/lib/utils'

type Props = { open: boolean; onOpenChange: (open: boolean) => void }

/** "Add to Home Screen" guide for iOS Safari (ui_ux.md §4, UC-26): Share → Add to Home Screen → Add. */
export function InstallHint({ open, onOpenChange }: Props) {
  const { t } = useTranslation()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-[480px]">
        <SheetHeader>
          <SheetTitle className="text-lg">{t('install.title')}</SheetTitle>
          <SheetDescription>{t('install.why')}</SheetDescription>
        </SheetHeader>
        <InstallSteps className="px-4" />
        <div className="p-4">
          <Button size="xl" className="w-full" onClick={() => onOpenChange(false)}>
            {t('install.done')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** The three illustrated steps, also shown by onboarding (S-01 step 5). */
export function InstallSteps({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <ol className={cn('flex flex-col gap-3', className)}>
      <Step number={1} icon={<Share className="size-5" />} text={t('install.share')} />
      <Step number={2} icon={<SquarePlus className="size-5" />} text={t('install.addToHome')} />
      <Step
        number={3}
        icon={<span className="text-sm font-semibold">{t('install.addLabel')}</span>}
        text={t('install.add')}
      />
    </ol>
  )
}

function Step({ number, icon, text }: { number: number; icon: ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium">
        {number}
      </span>
      <span className="flex min-w-11 shrink-0 items-center justify-center text-primary" aria-hidden>
        {icon}
      </span>
      <span>{text}</span>
    </li>
  )
}

/** Shows the install hint once in iOS Safari when the app is not installed; closing it is remembered. */
export function AutoInstallHint() {
  const shown = useMeta('install_hint_shown')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (shown === null && isIosSafari() && !isStandalone()) setOpen(true)
  }, [shown])

  return (
    <InstallHint
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) void setMeta('install_hint_shown', true)
      }}
    />
  )
}
