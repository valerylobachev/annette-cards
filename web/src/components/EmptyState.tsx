import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

type Props = {
  message: string
  actionLabel: string
  onAction: () => void
  /** Optional secondary actions below the primary one. */
  children?: ReactNode
}

/** Illustration-free empty state: short text and one primary action (ui_ux.md §4). */
export function EmptyState({ message, actionLabel, onAction, children }: Props) {
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-16 text-center">
      <p className="text-lg text-muted-foreground">{message}</p>
      <div className="flex w-full max-w-xs flex-col gap-2">
        <Button size="xl" onClick={onAction}>
          {actionLabel}
        </Button>
        {children}
      </div>
    </div>
  )
}
