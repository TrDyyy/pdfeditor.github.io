export type Point = [number, number]

export interface PdfPointConverter {
  convertToPdfPoint(x: number, y: number): number[]
}

export function rotatePoint(x: number, y: number, angle: number): Point {
  const radians = (angle * Math.PI) / 180
  return [x * Math.cos(radians) - y * Math.sin(radians), x * Math.sin(radians) + y * Math.cos(radians)]
}

export function visualRectToPdf(
  viewport: PdfPointConverter,
  rect: { x: number; y: number; width: number; height: number; rotation: number },
) {
  const topLeft = rotatePoint(0, 0, rect.rotation)
  const bottomLeftOffset = rotatePoint(0, rect.height, rect.rotation)
  const bottomRightOffset = rotatePoint(rect.width, rect.height, rect.rotation)
  const bottomLeft = viewport.convertToPdfPoint(rect.x + bottomLeftOffset[0], rect.y + bottomLeftOffset[1])
  const bottomRight = viewport.convertToPdfPoint(rect.x + bottomRightOffset[0], rect.y + bottomRightOffset[1])
  const pdfTopLeft = viewport.convertToPdfPoint(rect.x + topLeft[0], rect.y + topLeft[1])
  const xVector: Point = [bottomRight[0] - bottomLeft[0], bottomRight[1] - bottomLeft[1]]
  const yVector: Point = [pdfTopLeft[0] - bottomLeft[0], pdfTopLeft[1] - bottomLeft[1]]
  return {
    x: bottomLeft[0],
    y: bottomLeft[1],
    width: Math.hypot(...xVector),
    height: Math.hypot(...yVector),
    rotation: Math.atan2(xVector[1], xVector[0]) * 180 / Math.PI,
  }
}
