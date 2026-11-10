import type { ScanCorners, ScanPoint } from '../types/scanner.types'

export function orderCorners(points: ScanPoint[]): ScanCorners {
  if (points.length !== 4) throw new Error('Cần đúng bốn điểm góc.')
  const center = points.reduce((value, point) => ({ x: value.x + point.x / 4, y: value.y + point.y / 4 }), { x: 0, y: 0 })
  const clockwise = [...points].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x))
  const topLeftIndex = clockwise.reduce((best, point, index) => point.x + point.y < clockwise[best].x + clockwise[best].y ? index : best, 0)
  const ordered = [...clockwise.slice(topLeftIndex), ...clockwise.slice(0, topLeftIndex)]
  return ordered as ScanCorners
}

function cross(a: ScanPoint, b: ScanPoint, c: ScanPoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

export function polygonArea(corners: ScanCorners) {
  return Math.abs(corners.reduce((sum, point, index) => {
    const next = corners[(index + 1) % 4]
    return sum + point.x * next.y - next.x * point.y
  }, 0) / 2)
}

export function isValidQuadrilateral(corners: ScanCorners, width: number, height: number) {
  if (corners.some((point) => point.x < 0 || point.y < 0 || point.x > width || point.y > height)) return false
  const signs = corners.map((point, index) => cross(point, corners[(index + 1) % 4], corners[(index + 2) % 4]))
  const convex = signs.every((value) => value > 0) || signs.every((value) => value < 0)
  return convex && polygonArea(corners) > width * height * 0.01
}

export function defaultCorners(width: number, height: number): ScanCorners {
  const x = width * 0.05
  const y = height * 0.05
  return [{ x, y }, { x: width - x, y }, { x: width - x, y: height - y }, { x, y: height - y }]
}
