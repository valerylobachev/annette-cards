export type FieldErrorCode = 'required' | 'too_long'

/** A validation problem of one input field; the UI maps `code` to a localized `validation.*` message. */
export type FieldError = { field: string; code: FieldErrorCode; max?: number }

/** Thrown by repositories when input is invalid; aborts the surrounding transaction. */
export class ValidationError extends Error {
  readonly errors: FieldError[]

  constructor(errors: FieldError[]) {
    super(`Invalid input: ${errors.map((e) => `${e.field} ${e.code}`).join(', ')}`)
    this.name = 'ValidationError'
    this.errors = errors
  }
}

/** Checks a trimmed text field; returns the errors for it (empty when valid). */
export function checkText(
  field: string,
  value: string | null,
  { required = false, max }: { required?: boolean; max: number },
) {
  const errors: FieldError[] = []
  if (required && !value) errors.push({ field, code: 'required' })
  if (value && [...value].length > max) errors.push({ field, code: 'too_long', max })
  return errors
}
