import { PDFDocument } from 'pdf-lib'
import { renderExportImage } from './perspectiveTransform'
import type { ScannerAsset, ScannerPage } from '../types/scanner.types'

export type ScanQuality = 'compact' | 'standard' | 'sharp'
export type ScanPageSize = 'a4' | 'content'
export type ScanExportFormat = 'png' | 'jpeg' | 'pdf'

const QUALITY = {
  compact: { maxPixels: 3_500_000, maxSide: 2200, jpeg: .82 },
  standard: { maxPixels: 8_700_000, maxSide: 3600, jpeg: .92 },
  sharp: { maxPixels: 12_000_000, maxSide: 4600, jpeg: .96 },
} as const

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Không thể tạo file ảnh.')), type, quality))
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a')
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ') || 'scan'
}

export async function exportScan(asset: ScannerAsset, page: ScannerPage, name: string, format: ScanExportFormat, quality: ScanQuality, pageSize: ScanPageSize) {
  const preset = QUALITY[quality]; const canvas = document.createElement('canvas')
  const rendered = await renderExportImage(asset.image, page.settings, canvas, preset.maxPixels, preset.maxSide)
  const stem = safeName(name)
  if (format === 'png') {
    const blob = await canvasBlob(canvas, 'image/png'); download(blob, `${stem}.png`)
    return { ...rendered, bytes: blob.size }
  }
  const jpeg = await canvasBlob(canvas, 'image/jpeg', preset.jpeg)
  if (format === 'jpeg') {
    download(jpeg, `${stem}.jpg`)
    return { ...rendered, bytes: jpeg.size }
  }
  const pdf = await PDFDocument.create(); const image = await pdf.embedJpg(await jpeg.arrayBuffer())
  const portrait = canvas.height >= canvas.width
  let pageWidth = portrait ? 595.28 : 841.89; let pageHeight = portrait ? 841.89 : 595.28
  if (pageSize === 'content') {
    const max = 841.89; const scale = Math.min(max / canvas.width, max / canvas.height)
    pageWidth = canvas.width * scale; pageHeight = canvas.height * scale
  }
  const pdfPage = pdf.addPage([pageWidth, pageHeight])
  const scale = Math.min(pageWidth / image.width, pageHeight / image.height)
  const width = image.width * scale; const height = image.height * scale
  pdfPage.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height })
  const bytes = await pdf.save(); download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${stem}.pdf`)
  return { ...rendered, bytes: bytes.byteLength }
}
