import { useEffect, useRef } from 'react'

const PULL_DISTANCE = 60

/** Calls `onReveal` when the user pulls down while the page is scrolled to the top (ui_ux.md §6). */
export function usePullToReveal(onReveal: () => void) {
  const callback = useRef(onReveal)
  callback.current = onReveal

  useEffect(() => {
    let startY: number | null = null
    const onStart = (event: TouchEvent) => {
      startY = window.scrollY <= 0 ? (event.touches[0]?.clientY ?? null) : null
    }
    const onMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY
      if (startY === null || y === undefined || y - startY < PULL_DISTANCE) return
      startY = null
      callback.current()
    }
    const onEnd = () => {
      startY = null
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
  }, [])
}
