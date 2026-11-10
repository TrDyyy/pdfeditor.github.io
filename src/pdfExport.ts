import { PDFDocument, degrees, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import beVietnamRegular from '@expo-google-fonts/be-vietnam-pro/400Regular/BeVietnamPro_400Regular.ttf?url'
import beVietnamBold from '@expo-google-fonts/be-vietnam-pro/700Bold/BeVietnamPro_700Bold.ttf?url'
import beVietnamItalic from '@expo-google-fonts/be-vietnam-pro/400Regular_Italic/BeVietnamPro_400Regular_Italic.ttf?url'
import beVietnamBoldItalic from '@expo-google-fonts/be-vietnam-pro/700Bold_Italic/BeVietnamPro_700Bold_Italic.ttf?url'
import timesRegular from '@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf?url'
import timesBold from '@expo-google-fonts/noto-serif/700Bold/NotoSerif_700Bold.ttf?url'
import timesItalic from '@expo-google-fonts/noto-serif/400Regular_Italic/NotoSerif_400Regular_Italic.ttf?url'
import timesBoldItalic from '@expo-google-fonts/noto-serif/700Bold_Italic/NotoSerif_700Bold_Italic.ttf?url'
import type { BinaryAsset, PageModel } from './types'
import type { OverlayImage } from './types'
import { rotatePoint, visualRectToPdf } from './overlayGeometry'

function loadHtmlImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Không thể đọc ảnh để cắt xén.'))
    image.src = source
  })
}

async function croppedPngBytes(overlay: OverlayImage): Promise<Uint8Array> {
  const image = await loadHtmlImage(overlay.source)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(overlay.cropWidth))
  canvas.height = Math.max(1, Math.round(overlay.cropHeight))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Trình duyệt không hỗ trợ cắt ảnh.')
  context.drawImage(
    image,
    overlay.cropX,
    overlay.cropY,
    overlay.cropWidth,
    overlay.cropHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Không thể xuất ảnh đã cắt.')), 'image/png'),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

export async function exportPdf(source: ArrayBuffer, pages: PageModel[], assets = new Map<string, BinaryAsset>()): Promise<Uint8Array> {
  // Always start from the original bytes so repeated exports cannot accumulate overlays.
  const document = await PDFDocument.load(source.slice(0))
  document.registerFontkit(fontkit)
  const embedded = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>()
  const fontFiles = {
    'Be Vietnam Pro': { regular: beVietnamRegular, bold: beVietnamBold, italic: beVietnamItalic, boldItalic: beVietnamBoldItalic },
    'DejaVu Sans': { regular: 'fonts/DejaVuSans.ttf', bold: 'fonts/DejaVuSans-Bold.ttf', italic: 'fonts/DejaVuSans-Oblique.ttf', boldItalic: 'fonts/DejaVuSans-BoldOblique.ttf' },
    'Times New Roman': { regular: timesRegular, bold: timesBold, italic: timesItalic, boldItalic: timesBoldItalic },
  } as const
  const fontKey = (family: string, style: string) => `${family}:${style}`
  const usedStyles = new Set(pages.flatMap((page) => page.texts.map((text) => fontKey(text.fontFamily, text.bold && text.italic ? 'boldItalic' : text.bold ? 'bold' : text.italic ? 'italic' : 'regular'))))
  if (pages.some((page) => page.graphics.some((graphic) => graphic.kind === 'stamp'))) usedStyles.add(fontKey('DejaVu Sans', 'bold'))
  const fonts = new Map<string, Awaited<ReturnType<PDFDocument['embedFont']>>>()
  for (const key of usedStyles) {
    const [requestedFamily, requestedStyle] = key.split(':')
    const family = requestedFamily in fontFiles ? requestedFamily as keyof typeof fontFiles : 'DejaVu Sans'
    const style = requestedStyle as keyof (typeof fontFiles)['DejaVu Sans']
    const source = fontFiles[family][style]
    let bytes: ArrayBuffer | Uint8Array
    if (typeof source === 'string') {
      const response = await fetch(new URL(source, globalThis.document.baseURI))
      if (!response.ok) throw new Error('Không thể tải font Unicode để xuất PDF.')
      bytes = await response.arrayBuffer()
    } else bytes = source
    // fontkit's subset encoder can drop/re-map basic Latin glyphs for some
    // modern Vietnamese/serif fonts (for example ROTIC became RO C). Embed
    // the complete program so screen text and exported PDF stay identical.
    fonts.set(key, await document.embedFont(bytes, { subset: false }))
  }

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const model = pages[pageIndex]
    const outputPage = document.getPage(pageIndex)
    const viewport = model.page.getViewport({ scale: 1 })

    for (const graphic of model.graphics) {
      const geometry = visualRectToPdf(viewport, graphic)
      if (graphic.kind === 'signature') {
        const asset = assets.get(graphic.assetId)
        if (!asset) continue
        let image = embedded.get(asset.id)
        if (!image) {
          image = asset.mimeType === 'image/png' ? await document.embedPng(asset.bytes) : await document.embedJpg(asset.bytes)
          embedded.set(asset.id, image)
        }
        outputPage.drawImage(image, { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, rotate: degrees(geometry.rotation), opacity: graphic.opacity })
        continue
      }
      if (graphic.kind === 'line' || graphic.kind === 'arrow') {
        const localStart = rotatePoint(0, graphic.height / 2, graphic.rotation)
        const localEnd = rotatePoint(graphic.width, graphic.height / 2, graphic.rotation)
        const startVisual: [number, number] = [graphic.x + localStart[0], graphic.y + localStart[1]]
        const endVisual: [number, number] = [graphic.x + localEnd[0], graphic.y + localEnd[1]]
        const start = viewport.convertToPdfPoint(...startVisual)
        const end = viewport.convertToPdfPoint(...endVisual)
        outputPage.drawLine({ start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] }, thickness: graphic.strokeWidth, color: hexToRgb(graphic.stroke), opacity: graphic.opacity })
        if (graphic.kind === 'arrow') {
          const angle = Math.atan2(start[1] - end[1], start[0] - end[0])
          const length = 12 + graphic.strokeWidth
          for (const offset of [-0.5, 0.5]) {
            outputPage.drawLine({ start: { x: end[0], y: end[1] }, end: { x: end[0] + Math.cos(angle + offset) * length, y: end[1] + Math.sin(angle + offset) * length }, thickness: graphic.strokeWidth, color: hexToRgb(graphic.stroke), opacity: graphic.opacity })
          }
        }
        continue
      }
      const fillColor = graphic.kind === 'whiteout' ? '#ffffff' : graphic.kind === 'highlight' ? graphic.color : graphic.kind === 'stamp' ? '#ffffff' : graphic.fill
      const fillPdfColor = fillColor === 'transparent' || fillColor.endsWith('00') ? undefined : hexToRgb(fillColor)
      const borderColor = graphic.kind === 'stamp' ? graphic.color : graphic.kind === 'rectangle' || graphic.kind === 'ellipse' ? graphic.stroke : undefined
      const borderWidth = graphic.kind === 'stamp' ? 4 : graphic.kind === 'rectangle' || graphic.kind === 'ellipse' ? graphic.strokeWidth : 0
      if (graphic.kind === 'ellipse') {
        const center = viewport.convertToPdfPoint(graphic.x + graphic.width / 2, graphic.y + graphic.height / 2)
        outputPage.drawEllipse({ x: center[0], y: center[1], xScale: geometry.width / 2, yScale: geometry.height / 2, rotate: degrees(geometry.rotation), color: fillPdfColor, borderColor: borderColor ? hexToRgb(borderColor) : undefined, borderWidth, opacity: graphic.opacity, borderOpacity: graphic.opacity })
      } else {
        outputPage.drawRectangle({ x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, rotate: degrees(geometry.rotation), color: fillPdfColor, borderColor: borderColor ? hexToRgb(borderColor) : undefined, borderWidth, opacity: graphic.opacity, borderOpacity: graphic.opacity })
      }
      if (graphic.kind === 'stamp') {
        const font = fonts.get(fontKey('DejaVu Sans', 'bold'))
        if (font) {
          const size = Math.min(24, graphic.height * 0.38)
          const width = font.widthOfTextAtSize(graphic.label, size)
          const localX = Math.max(5, (graphic.width - width) / 2)
          const localY = graphic.height / 2 + size * 0.32
          const rad = graphic.rotation * Math.PI / 180
          const visual = [graphic.x + localX * Math.cos(rad) - localY * Math.sin(rad), graphic.y + localX * Math.sin(rad) + localY * Math.cos(rad)] as const
          const point = viewport.convertToPdfPoint(...visual)
          outputPage.drawText(graphic.label, { x: point[0], y: point[1], size, font, color: hexToRgb(graphic.color), rotate: degrees(geometry.rotation), opacity: graphic.opacity })
        }
      }
    }

    for (const overlay of model.overlays) {
      const isCropped = overlay.cropX !== 0
        || overlay.cropY !== 0
        || overlay.cropWidth !== overlay.naturalWidth
        || overlay.cropHeight !== overlay.naturalHeight
      const imageKey = `${overlay.source}:${overlay.cropX}:${overlay.cropY}:${overlay.cropWidth}:${overlay.cropHeight}`
      let image = embedded.get(imageKey)
      if (!image) {
        image = isCropped
          ? await document.embedPng(await croppedPngBytes(overlay))
          : overlay.mimeType === 'image/png'
            ? await document.embedPng(overlay.bytes)
            : await document.embedJpg(overlay.bytes)
        embedded.set(imageKey, image)
      }

      // Konva rotates clockwise around the visual top-left. Map its visual
      // bottom-left and horizontal axis through PDF.js' inverse viewport.
      const geometry = visualRectToPdf(viewport, overlay)

      outputPage.drawImage(image, {
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
        rotate: degrees(geometry.rotation),
        opacity: overlay.opacity,
      })
    }

    for (const text of model.texts) {
      const style = text.bold && text.italic ? 'boldItalic' : text.bold ? 'bold' : text.italic ? 'italic' : 'regular'
      const font = fonts.get(fontKey(text.fontFamily, style))
      if (!font) continue
      const unitX0 = viewport.convertToPdfPoint(0, 0)
      const unitX1 = viewport.convertToPdfPoint(1, 0)
      const pdfPerViewportUnit = Math.hypot(unitX1[0] - unitX0[0], unitX1[1] - unitX0[1])
      const pdfFontSize = text.fontSize * pdfPerViewportUnit
      const maxWidth = text.width * pdfPerViewportUnit
      const paragraphs = text.text.split('\n')
      const lines: string[] = []
      for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/)
        let line = ''
        for (const word of words) {
          const candidate = line ? `${line} ${word}` : word
          if (line && font.widthOfTextAtSize(candidate, pdfFontSize) > maxWidth) {
            lines.push(line)
            line = word
          } else line = candidate
        }
        lines.push(line)
      }
      const radians = (text.rotation * Math.PI) / 180
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex]
        const lineWidthViewport = font.widthOfTextAtSize(line, pdfFontSize) / pdfPerViewportUnit
        const alignOffset = text.align === 'center' ? (text.width - lineWidthViewport) / 2 : text.align === 'right' ? text.width - lineWidthViewport : 0
        const localX = alignOffset
        const localY = text.fontSize * 0.88 + lineIndex * text.fontSize * text.lineHeight
        if (localY > text.height) break
        const visualX = text.x + localX * Math.cos(radians) - localY * Math.sin(radians)
        const visualY = text.y + localX * Math.sin(radians) + localY * Math.cos(radians)
        const pdfPoint = viewport.convertToPdfPoint(visualX, visualY)
        const pdfXDirection = viewport.convertToPdfPoint(visualX + Math.cos(radians), visualY + Math.sin(radians))
        const angle = Math.atan2(pdfXDirection[1] - pdfPoint[1], pdfXDirection[0] - pdfPoint[0]) * 180 / Math.PI
        outputPage.drawText(line, {
          x: pdfPoint[0],
          y: pdfPoint[1],
          size: pdfFontSize,
          font,
          color: hexToRgb(text.color),
          rotate: degrees(angle),
        })
      }
    }
  }

  return document.save()
}

function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)
}
