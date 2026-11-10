interface WorkerResponse<T> { id: string; result?: T; error?: string }

let worker: Worker | null = null
const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timeout: number }>()

function getWorker() {
  if (!worker) {
    worker = new Worker(`${import.meta.env.BASE_URL}scanner.worker.js?v=7`)
    worker.onmessage = (event: MessageEvent<WorkerResponse<unknown>>) => {
      const request = pending.get(event.data.id)
      if (!request) return
      pending.delete(event.data.id)
      window.clearTimeout(request.timeout)
      if (event.data.error) request.reject(new Error(event.data.error))
      else request.resolve(event.data.result)
    }
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Scanner Worker gặp lỗi.')
      pending.forEach((request) => { window.clearTimeout(request.timeout); request.reject(error) }); pending.clear()
      worker?.terminate(); worker = null
    }
  }
  return worker
}

export function runScannerWorker<T>(type: 'detect' | 'perspective', payload: object, transfers: Transferable[] = []): Promise<T> {
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pending.delete(id)
      worker?.terminate()
      worker = null
      reject(new Error('Bộ xử lý ảnh không phản hồi đúng hạn. Worker đã được khởi động lại, hãy thử nhận diện lại.'))
    }, 45_000)
    pending.set(id, { resolve, reject, timeout })
    getWorker().postMessage({ id, type, payload }, transfers)
  })
}

export function disposeScannerWorker() {
  worker?.terminate(); worker = null
  pending.forEach((request) => { window.clearTimeout(request.timeout); request.reject(new Error('Scanner đã đóng.')) }); pending.clear()
}
