type Props = { label: string; share: number }

/** Determinate progress bar; `share` is 0…1. */
export function ProgressBar({ label, share }: Props) {
  const percent = Math.round(Math.min(1, Math.max(0, share)) * 100)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-secondary"
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
