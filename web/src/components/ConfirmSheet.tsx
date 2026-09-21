import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel: string
  onConfirm: () => void
}

/** iOS-style bottom sheet asking to confirm a destructive action (ui_ux.md §4). */
export function ConfirmSheet({ open, onOpenChange, title, description, confirmLabel, onConfirm }: Props) {
  const { t } = useTranslation()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="mx-auto max-w-[480px]">
        <SheetHeader className="text-center">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          <SheetDescription className={description ? undefined : 'sr-only'}>{description ?? title}</SheetDescription>
        </SheetHeader>
        <SheetFooter className="pt-0">
          <Button
            size="xl"
            variant="destructive"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </Button>
          <Button size="xl" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
