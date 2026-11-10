import { describe, expect, it } from 'vitest'
import { visualRectToPdf, type PdfPointConverter } from '../src/overlayGeometry'

function viewport(rotation: 0 | 90 | 180 | 270, pageWidth = 600, pageHeight = 800): PdfPointConverter {
  return {
    convertToPdfPoint(x, y) {
      if (rotation === 0) return [x, pageHeight - y]
      if (rotation === 90) return [y, x]
      if (rotation === 180) return [pageWidth - x, y]
      return [pageWidth - y, pageHeight - x]
    },
  }
}

describe('overlay coordinate mapping', () => {
  it.each([0, 90, 180, 270] as const)('preserves size on a page rotated %s°', (rotation) => {
    const result = visualRectToPdf(viewport(rotation), { x: 75, y: 120, width: 180, height: 90, rotation: 17 })
    expect(result.width).toBeCloseTo(180, 8)
    expect(result.height).toBeCloseTo(90, 8)
  })

  it.each([0.5, 1, 2])('is independent of browser zoom %s', (zoom) => {
    const documentRect = { x: 48, y: 92, width: 160, height: 70, rotation: 0 }
    const screenRect = Object.fromEntries(Object.entries(documentRect).map(([key, value]) => [key, key === 'rotation' ? value : value * zoom]))
    const normalized = {
      x: screenRect.x / zoom,
      y: screenRect.y / zoom,
      width: screenRect.width / zoom,
      height: screenRect.height / zoom,
      rotation: screenRect.rotation,
    }
    expect(visualRectToPdf(viewport(0), normalized)).toEqual(visualRectToPdf(viewport(0), documentRect))
  })
})
