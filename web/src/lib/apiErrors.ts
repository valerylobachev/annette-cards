import type { ParseKeys } from 'i18next'
import i18n from '@/i18n'

/** Error codes the client translates (architecture.md §5.3, plus `network` and `unknown` from the client). */
export const API_ERROR_CODES = [
  'invalid_credentials',
  'invite_invalid',
  'invite_expired',
  'email_taken',
  'rate_limited',
  'password_too_short',
  'validation_failed',
  'unauthorized',
  'forbidden',
  'invite_used',
  'origin_mismatch',
  'payload_too_large',
  'account_not_empty',
  'unsupported_version',
  'invalid_format',
  'not_found',
  'tts_disabled',
  'commons_disabled',
  'unsupported_language',
  'provider_error',
  'provider_timeout',
  'enrich_disabled',
  'enrich_quota_exceeded',
  'internal_error',
  'service_unavailable',
  'network',
  'unknown',
] as const

/** `errors.<code>`, or `errors.unknown` for a code the client does not know. */
export function errorMessageKey(code: string): ParseKeys {
  const known = (API_ERROR_CODES as readonly string[]).includes(code)
  return `errors.${known ? code : 'unknown'}` as ParseKeys
}

/** The translated message for an error code in the current UI language. */
export function errorMessage(code: string): string {
  return i18n.t(errorMessageKey(code))
}
