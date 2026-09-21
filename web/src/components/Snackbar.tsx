import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export type SnackbarOptions = {
  message: string
  /** Label of the single action, e.g. "Undo". */
  actionLabel?: string
  onAction?: () => void
  /** Milliseconds before the snackbar hides; default 4 s (ui_ux.md §4). */
  duration?: number
}

type SnackbarApi = { show: (options: SnackbarOptions) => void }

const SnackbarContext = createContext<SnackbarApi | null>(null)

export const SNACKBAR_DURATION = 4000

/** Shows one snackbar at a time at the bottom of the screen; a new one replaces the current one. */
export function SnackbarProvider({ aboveTabBar, children }: { aboveTabBar: boolean; children: ReactNode }) {
  const [current, setCurrent] = useState<(SnackbarOptions & { key: number }) | null>(null)
  const counter = useRef(0)

  const show = useCallback((options: SnackbarOptions) => {
    counter.current += 1
    setCurrent({ ...options, key: counter.current })
  }, [])

  useEffect(() => {
    if (!current) return
    const timer = setTimeout(() => setCurrent(null), current.duration ?? SNACKBAR_DURATION)
    return () => clearTimeout(timer)
  }, [current])

  const api = useMemo(() => ({ show }), [show])

  return (
    <SnackbarContext value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4',
          aboveTabBar
            ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))]'
            : 'bottom-[calc(1rem+env(safe-area-inset-bottom))]',
        )}
      >
        {current && (
          <div
            key={current.key}
            className="pointer-events-auto flex w-full max-w-[480px] items-center gap-3 rounded-xl bg-foreground py-1 pr-1 pl-4 text-background shadow-lg animate-in fade-in-0 slide-in-from-bottom-2"
          >
            <span className="flex-1 py-2.5">{current.message}</span>
            {current.actionLabel && (
              <button
                type="button"
                className="min-h-11 rounded-lg px-3 font-semibold text-background underline-offset-4 hover:underline"
                onClick={() => {
                  current.onAction?.()
                  setCurrent(null)
                }}
              >
                {current.actionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </SnackbarContext>
  )
}

export function useSnackbar(): SnackbarApi {
  const api = useContext(SnackbarContext)
  if (!api) throw new Error('useSnackbar must be used inside SnackbarProvider')
  return api
}
