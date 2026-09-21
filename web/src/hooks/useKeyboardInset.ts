import { useEffect, useState } from 'react'

/**
 * Height covered by the on-screen keyboard, in px. iOS Safari does not resize the layout viewport for the
 * keyboard, so bottom-fixed UI (sheets, helper rows) uses this to stay above it.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)))
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
