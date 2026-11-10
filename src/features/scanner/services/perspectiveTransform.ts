import { runScannerWorker } from './scannerWorkerClient'
import type { ScanSettings } from '../types/scanner.types'

interface WorkerPerspectiveResult { buffer: ArrayBuffer; width: number; height: number }

function distance(a: { x: number; y: number }, b: { x: number; y: number }) { return Math.hypot(a.x - b.x, a.y - b.y) }

interface RenderOptions { maxPixels: number; maxSourceSide: number }

async function renderScan(image: HTMLImageElement, settings: ScanSettings, output: HTMLCanvasElement, options: RenderOptions) {
  const { corners, rotation } = settings
  const [tl, tr, br, bl] = corners
  const width = Math.max(1, Math.round(Math.max(distance(tl, tr), distance(bl, br))))
  const height = Math.max(1, Math.round(Math.max(distance(tl, bl), distance(tr, br))))
  // This is an interactive preview, not the final export. Avoid reading a
  // 12–48 MP phone photo into WASM when a screen-sized source is sufficient.
  const outputScale = Math.min(
    1,
    options.maxSourceSide / Math.max(image.naturalWidth, image.naturalHeight),
    Math.sqrt(options.maxPixels / (width * height)),
  )
  const targetWidth = Math.max(1, Math.round(width * outputScale))
  const targetHeight = Math.max(1, Math.round(height * outputScale))
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = Math.max(1, Math.round(image.naturalWidth * outputScale))
  sourceCanvas.height = Math.max(1, Math.round(image.naturalHeight * outputScale))
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
  if (!sourceContext) throw new Error('Trình duyệt không thể đọc ảnh để tạo preview.')
  sourceContext.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height)
  const warpedCanvas = document.createElement('canvas')
  const pixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data
  const warped = await runScannerWorker<WorkerPerspectiveResult>('perspective', {
    buffer: pixels.buffer,
    sourceWidth: sourceCanvas.width,
    sourceHeight: sourceCanvas.height,
    corners: corners.map((point) => ({ x: point.x * outputScale, y: point.y * outputScale })),
    width: targetWidth,
    height: targetHeight,
    settings: { filter: settings.filter, brightness: settings.brightness, contrast: settings.contrast, sharpen: settings.sharpen, threshold: settings.threshold },
  }, [pixels.buffer as ArrayBuffer])
  warpedCanvas.width = warped.width
  warpedCanvas.height = warped.height
  const warpedContext = warpedCanvas.getContext('2d')
  if (!warpedContext) throw new Error('Trình duyệt không thể hiển thị preview.')
  warpedContext.putImageData(new ImageData(new Uint8ClampedArray(warped.buffer), warped.width, warped.height), 0, 0)

  const sideways = rotation === 90 || rotation === 270
  output.width = sideways ? warpedCanvas.height : warpedCanvas.width
  output.height = sideways ? warpedCanvas.width : warpedCanvas.height
  const context = output.getContext('2d')!
  context.save(); context.translate(output.width / 2, output.height / 2); context.rotate(rotation * Math.PI / 180)
  context.drawImage(warpedCanvas, -warpedCanvas.width / 2, -warpedCanvas.height / 2); context.restore()
  return { width: output.width, height: output.height, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight, scale: outputScale }
}

export function renderPerspective(image: HTMLImageElement, settings: ScanSettings, output: HTMLCanvasElement) {
  return renderScan(image, settings, output, { maxPixels: 5_000_000, maxSourceSide: 2200 })
}

export function renderExportImage(image: HTMLImageElement, settings: ScanSettings, output: HTMLCanvasElement, maxPixels: number, maxSourceSide: number) {
  return renderScan(image, settings, output, { maxPixels, maxSourceSide })
}
