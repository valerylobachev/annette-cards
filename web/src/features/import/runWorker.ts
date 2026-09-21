import type { WorkerRequest, WorkerResponse } from './protocol'

type Final = Exclude<WorkerResponse, { type: 'progress' }>

/** Runs one request in a fresh import worker and resolves with its final message. */
export function runImportWorker(request: WorkerRequest, onProgress: (share: number) => void): Promise<Final> {
  const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })
  return new Promise<Final>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') return onProgress(message.share)
      worker.terminate()
      resolve(message)
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message))
    }
    const transfer = 'bytes' in request ? [request.bytes] : []
    worker.postMessage(request, transfer)
  })
}
