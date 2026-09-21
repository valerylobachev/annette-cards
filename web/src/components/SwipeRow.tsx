import { type PointerEvent, type ReactNode, useRef, useState } from 'react'

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE = 8

type Props = {
  /** Buttons revealed by swiping the row left; `close` slides the row back. */
  actions?: (close: () => void) => ReactNode
  /** Total width of the revealed actions in px. */
  actionsWidth?: number
  onLongPress?: () => void
  children: ReactNode
}

type Drag = { x: number; y: number; base: number; horizontal: boolean | null }

/**
 * A list row with the gestures from ui_ux.md §6: swipe left reveals actions, long-press (or right-click) runs
 * `onLongPress`. Every gesture must also have a visible button elsewhere in the row (accessibility).
 */
export function SwipeRow({ actions, actionsWidth = 0, onLongPress, children }: Props) {
  const [offset, setOffset] = useState(0)
  const drag = useRef<Drag | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const swallowClick = useRef(false)

  const close = () => setOffset(0)

  function onPointerDown(event: PointerEvent) {
    // React events from portals (menus, sheets opened from this row) bubble here too; ignore them.
    if (!event.currentTarget.contains(event.target as Node)) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    swallowClick.current = false
    drag.current = { x: event.clientX, y: event.clientY, base: offset, horizontal: null }
    if (onLongPress) {
      timer.current = setTimeout(() => {
        drag.current = null
        swallowClick.current = true
        onLongPress()
      }, LONG_PRESS_MS)
    }
  }

  function onPointerMove(event: PointerEvent) {
    const current = drag.current
    if (!current) return
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (current.horizontal === null && Math.hypot(dx, dy) > MOVE_TOLERANCE) {
      clearTimeout(timer.current)
      current.horizontal = actions !== undefined && Math.abs(dx) > Math.abs(dy)
      if (current.horizontal) event.currentTarget.setPointerCapture?.(event.pointerId)
    }
    if (current.horizontal) setOffset(Math.min(0, Math.max(-actionsWidth, current.base + dx)))
  }

  function onPointerEnd() {
    clearTimeout(timer.current)
    const current = drag.current
    drag.current = null
    if (!current?.horizontal) return
    swallowClick.current = true
    setOffset((value) => (value < -actionsWidth / 2 ? -actionsWidth : 0))
  }

  return (
    <div className="relative overflow-hidden">
      {actions && (
        <div
          className="absolute inset-y-0 right-0 flex"
          style={{ width: actionsWidth }}
          aria-hidden={offset === 0}
          inert={offset === 0}
        >
          {actions(close)}
        </div>
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: gestures are shortcuts; each action also has a button */}
      <div
        className="relative flex touch-pan-y items-center bg-background transition-transform duration-150 select-none [-webkit-touch-callout:none]"
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onContextMenu={(event) => {
          if (!onLongPress || !event.currentTarget.contains(event.target as Node)) return
          event.preventDefault()
          onLongPress()
        }}
        onClickCapture={(event) => {
          if (!event.currentTarget.contains(event.target as Node)) return
          if (!swallowClick.current && offset === 0) return
          // The click that ends a swipe or long-press is swallowed; a tap on an open row closes it.
          event.preventDefault()
          event.stopPropagation()
          if (swallowClick.current) swallowClick.current = false
          else close()
        }}
      >
        {children}
      </div>
    </div>
  )
}
