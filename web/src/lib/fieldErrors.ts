import type { TFunction } from 'i18next'
import type { FieldError } from '@/domain/validation'

/** Localized message for a domain validation error. */
export function fieldErrorMessage(t: TFunction, error: FieldError): string {
  switch (error.code) {
    case 'required':
      return t('validation.required')
    case 'too_long':
      return t('validation.tooLong', { max: error.max })
    case 'invalid':
      return t('validation.invalidNumber')
  }
}

/** The first error per field, as localized messages keyed by field name. */
export function fieldErrorMessages(t: TFunction, errors: FieldError[]): Record<string, string> {
  const messages: Record<string, string> = {}
  for (const error of errors) messages[error.field] ??= fieldErrorMessage(t, error)
  return messages
}
