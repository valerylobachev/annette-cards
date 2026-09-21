// Parses and validates import files off the main thread (S-10: 10 000 rows must not freeze the UI).
import { parseDelimited } from '@/domain/import/parse'
import { decodeUtf8 } from '@/domain/import/utf8'
import { validateRows } from '@/domain/import/validate'
import type { WorkerRequest, WorkerResponse } from './protocol'

// The project compiles against the DOM lib, so the worker scope is typed here by hand.
const scope = self as unknown as {
  postMessage: (message: WorkerResponse) => void
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
}

function post(message: WorkerResponse) {
  scope.postMessage(message)
}

const progress = (share: number) => post({ type: 'progress', share })

scope.onmessage = (event) => {
  const request = event.data
  if (request.type === 'validate') {
    post({ type: 'validated', rows: validateRows(request.rows, request.mapping, request.existingFronts, progress) })
    return
  }
  const text = 'text' in request ? request.text : decodeUtf8(new Uint8Array(request.bytes))
  if (text === null) return post({ type: 'failed', code: 'not_utf8' })
  const table = parseDelimited(text, progress)
  if (table.rows.length === 0) return post({ type: 'failed', code: 'empty' })
  post({ type: 'parsed', table })
}
