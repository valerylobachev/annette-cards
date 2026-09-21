import { useQuery } from '@tanstack/react-query'
import { meta } from '@/api/endpoints/system/system'
import { useMeta } from '@/db/hooks'
import { type ServerFeatures, setMeta } from '@/db/meta'
import { callApi } from './api'
import { useOnline } from './useOnline'

/** `GET /api/meta`, shared by Settings → About and the feature flags; the features are kept in `meta`. */
export function useServerMeta() {
  const online = useOnline()
  return useQuery({
    queryKey: ['meta'],
    queryFn: async () => {
      const answer = await callApi(() => meta())
      await setMeta('server_features', answer.features)
      return answer
    },
    enabled: online,
  })
}

/**
 * The server's optional features (TTS, Commons, enrichment, push): fetched when online and remembered on this device,
 * so the UI knows them offline too. `null` until the server answered once.
 */
export function useServerFeatures(): ServerFeatures | null {
  useServerMeta()
  return useMeta('server_features') ?? null
}
