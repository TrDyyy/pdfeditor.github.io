import { defaultCorners, orderCorners } from '../composables/useCropSelection'
import { runScannerWorker } from './scannerWorkerClient'
import type { DetectionResult, ScanPoint } from '../types/scanner.types'

interface WorkerDetectionResult {
  points: ScanPoint[]
  area: number
}

export async function detectDocument(image: HTMLImageElement): Promise<DetectionResult> {
  // Detection does not need export resolution. Keeping the longest edge at
  // 900 px makes Canny/contour analysis much faster on phone photographs.
  const maxSide = 640
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Trình duyệt không thể đọc ảnh để nhận diện.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  try {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const best = await runScannerWorker<WorkerDetectionResult | null>('detect', {
      buffer: pixels.buffer,
      width: canvas.width,
      height: canvas.height,
    }, [pixels.buffer as ArrayBuffer])
    const imageArea = canvas.width * canvas.height
    if (!best) return { corners: defaultCorners(image.naturalWidth, image.naturalHeight), confidence: 'low', areaRatio: 0 }
    const areaRatio = best.area / imageArea
    const corners = orderCorners(best.points).map((point) => ({ x: point.x / scale, y: point.y / scale })) as DetectionResult['corners']
    return { corners, confidence: areaRatio > 0.55 ? 'high' : areaRatio > 0.28 ? 'medium' : 'low', areaRatio }
  } catch (error) {
    throw new Error(`Không thể nhận diện mép giấy: ${error instanceof Error ? error.message : 'bộ xử lý ảnh gặp lỗi'}`)
  }
}
