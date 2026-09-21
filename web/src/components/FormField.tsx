import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'

type Props = { id: string; label: string; error?: string; hint?: string; children: ReactNode }

/** Label, control, then a hint or an error message linked to the control. */
export function FormField({ id, label, error, hint, children }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-sm text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
