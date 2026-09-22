import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

/** A tapped reminder (src/sw.ts) opens Today in the window that is already open. */
export function useNotificationTaps() {
  const navigate = useNavigate()
  useEffect(() => {
    const worker = navigator.serviceWorker
    if (!worker) return
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'open-today') void navigate({ to: '/' })
    }
    worker.addEventListener('message', onMessage)
    return () => worker.removeEventListener('message', onMessage)
  }, [navigate])
}
