import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { enrich } from '@/api/endpoints/enrich/enrich'
import type { EnrichRequest, EnrichResponse } from '@/api/model'
import { markSessionExpired, useAccount } from '@/features/auth/account'
import { apiErrorCode, callApi, isUnauthorized } from '@/lib/api'
import { useServerFeatures } from '@/lib/serverFeatures'
import { useOnline } from '@/lib/useOnline'

export type EnrichInput = Pick<EnrichRequest, 'front' | 'target_lang' | 'native_lang'>

/**
 * AI suggestions for a word (`POST /api/enrich`, UC-09). The server already retries an invalid answer, so the
 * request is never retried here; a pending request is aborted when a new one starts or the component unmounts.
 * `available`: the server offers enrichment and the learner is signed in (the button is shown); `canEnrich`: also
 * online (the button works); `ready`: both are known (they are read from the device first).
 * `error` is the server's error code (`enrich_quota_exceeded`, `network`, …).
 */
export function useEnrich() {
  const features = useServerFeatures()
  const account = useAccount()
  const online = useOnline()
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  const mutation = useMutation({
    mutationFn: (input: EnrichInput): Promise<EnrichResponse> => {
      controller.current?.abort()
      const current = new AbortController()
      controller.current = current
      return callApi(() => enrich(input, { signal: current.signal }))
    },
    retry: false,
    onError: (failure) => {
      if (isUnauthorized(failure)) void markSessionExpired()
    },
  })

  const available = features?.enrich === true && !!account?.account && !account.sessionExpired
  return {
    ready: account !== undefined && features !== undefined,
    available,
    canEnrich: available && online,
    suggest: mutation.mutateAsync,
    data: mutation.data,
    error: mutation.error ? apiErrorCode(mutation.error) : null,
    isPending: mutation.isPending,
    reset: mutation.reset,
  }
}

/** The inline message for a failed request (ui_ux.md §7): the quota has its own text, anything else one hint. */
export function enrichErrorKey(code: string): 'errors.enrich_quota_exceeded' | 'enrich.failed' {
  return code === 'enrich_quota_exceeded' ? 'errors.enrich_quota_exceeded' : 'enrich.failed'
}
