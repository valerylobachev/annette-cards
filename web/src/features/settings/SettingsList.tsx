import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/db/hooks'
import { updateSettings } from '@/db/settings'
import type { Settings } from '@/domain/types'
import { cn } from '@/lib/utils'

/** One group of the iOS-style grouped list (S-14): a small title above a rounded block of rows. */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="flex flex-col divide-y rounded-2xl border bg-card">{children}</div>
    </section>
  )
}

type RowProps = { label: ReactNode; htmlFor?: string; hint?: string; children?: ReactNode; stacked?: boolean }

/** A row: label (+ hint) and its control, side by side or, for wide controls, stacked. */
export function SettingsRow({ label, htmlFor, hint, children, stacked = false }: RowProps) {
  return (
    <div className={cn('flex min-h-14 gap-3 px-4 py-3', stacked ? 'flex-col' : 'items-center justify-between')}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

type SegmentedProps<T extends string> = {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}

/** A choice of a few options as pressed/unpressed buttons. */
export function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a form fieldset
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option.value}
          size="lg"
          variant={value === option.value ? 'default' : 'outline'}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

/** Native select (the iOS wheel picker) over a list of numbers. */
export function NumberSelect({
  id,
  values,
  value,
  format = String,
  onChange,
}: {
  id: string
  values: number[]
  value: number
  format?: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-11 rounded-lg border bg-background px-3 tabular-nums"
    >
      {values.map((option) => (
        <option key={option} value={option}>
          {format(option)}
        </option>
      ))}
    </select>
  )
}

/**
 * The settings document with this screen's changes shown at once: a control would otherwise snap back until the
 * write reaches the live query. A change is dropped from the overlay once the stored value matches it.
 */
export function useSettingsDraft() {
  const settings = useSettings()
  const [draft, setDraft] = useState<Partial<Settings>>({})

  useEffect(() => {
    setDraft((current) => {
      const pending = Object.entries(current).filter(([key, value]) => settings[key as keyof Settings] !== value)
      return pending.length === Object.keys(current).length ? current : Object.fromEntries(pending)
    })
  }, [settings])

  const save = useCallback((patch: Partial<Settings>) => {
    setDraft((current) => ({ ...current, ...patch }))
    void updateSettings(patch)
  }, [])

  return { settings: { ...settings, ...draft }, save }
}
