import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

type Props = {
  text: string
  /** Starting font size in px. */
  max: number
  /** Smallest font size in px; below it the text scrolls. */
  min?: number
  lang?: string
  className?: string
}

const STEP_PX = 2

/**
 * Text that shrinks from `max` to `min` px to fit the free height of its flex column, then scrolls inside it
 * (ui_ux.md §7). The text is centered vertically while it fits.
 */
export function FitText({ text, max, min = 20, lang, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(max)

  // Runs before paint after every size step, so the shrinking is never visible.
  useLayoutEffect(() => {
    const box = ref.current
    if (box && size > min && box.scrollHeight > box.clientHeight) setSize(Math.max(min, size - STEP_PX))
  }, [size, min])

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col justify-center-safe overflow-y-auto">
      <p
        lang={lang}
        data-font-size={size}
        style={{ fontSize: size }}
        className={cn('leading-tight break-words whitespace-pre-line', className)}
      >
        {text}
      </p>
    </div>
  )
}
