import { describe, expect, it } from 'vitest'
import { defaultCorners, isValidQuadrilateral, orderCorners, polygonArea } from '../src/features/scanner/composables/useCropSelection'

describe('scanner crop geometry', () => {
  it('orders detected points clockwise from top-left', () => {
    expect(orderCorners([{ x: 900, y: 700 }, { x: 80, y: 90 }, { x: 100, y: 720 }, { x: 920, y: 100 }])).toEqual([
      { x: 80, y: 90 }, { x: 920, y: 100 }, { x: 900, y: 700 }, { x: 100, y: 720 },
    ])
  })

  it('rejects self-intersecting and tiny crops', () => {
    expect(isValidQuadrilateral([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }], 100, 100)).toBe(false)
    expect(isValidQuadrilateral([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }], 1000, 1000)).toBe(false)
  })

  it('creates a valid inset manual crop', () => {
    const corners = defaultCorners(1000, 1400)
    expect(isValidQuadrilateral(corners, 1000, 1400)).toBe(true)
    expect(polygonArea(corners)).toBeCloseTo(1_134_000)
  })
})
