type Listener = () => void

const listeners = new Set<Listener>()

/** Subscribes to committed local writes (the sync engine's debounced trigger). Returns the unsubscribe function. */
export function onLocalChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Called by `mutate` after a local write committed. */
export function notifyLocalChange() {
  for (const listener of listeners) listener()
}
