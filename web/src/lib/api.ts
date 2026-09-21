/**
 * Calling the generated API client (`src/api/`, orval). Its functions return `{ data, status }` for every HTTP
 * status; `callApi` returns the data of a 2xx response and throws `ApiError` otherwise, with the server's stable
 * error code (`{ "code": "invalid_credentials" }`) or `network` when the server could not be reached.
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(`API error ${status}: ${code}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

type ApiResponse = { status: number; data: unknown }

/** The `data` of a 2xx response, typed by the generated client's success variant. */
type SuccessData<R> = R extends { status: infer S; data: infer D } ? (S extends 200 | 201 | 204 ? D : never) : never

export async function callApi<R extends ApiResponse>(request: () => Promise<R>): Promise<SuccessData<R>> {
  let response: R
  try {
    response = await request()
  } catch {
    // fetch failed (offline, server down) or the body was not JSON (e.g. a proxy error page).
    throw new ApiError(0, 'network')
  }
  if (response.status >= 200 && response.status < 300) return response.data as SuccessData<R>
  throw new ApiError(response.status, errorCode(response.data))
}

function errorCode(data: unknown): string {
  if (typeof data === 'object' && data !== null && 'code' in data && typeof data.code === 'string') return data.code
  return 'unknown'
}

/** The stable error code of any thrown value. */
export function apiErrorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : 'unknown'
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}
