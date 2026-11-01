import { describe, expect, it } from 'vitest'

import { PX_Z, cameraBasis, capsuleLengthPx, capsuleSwell, chunkCount, cometLengthPx, frameBounds, projectPx, sideShade } from '../iso'

describe('the isometric frame', () => {
  it('projects a tile step the way design/iso.js does', () => {
    const x = projectPx(1, 0, 0)
    expect(x.sx).toBeCloseTo(32)
    expect(x.sy).toBeCloseTo(16)
    const z = projectPx(0, 0, 1)
    expect(z.sx).toBeCloseTo(-32)
    expect(z.sy).toBeCloseTo(16)
  })

  it('turns iso px of height into world units', () => {
    expect(projectPx(0, 35 * PX_Z, 0).sy).toBeCloseTo(-35)
  })

  it('plates a RAG capsule per 500 retrieved tokens, so the reranker strips 8 to 2', () => {
    expect(chunkCount(0)).toBe(0)
    expect(chunkCount(4000)).toBe(8) // vector DB
    expect(chunkCount(2000)).toBe(4) // BM25 alone
    expect(chunkCount(1200)).toBe(2) // reranked
    expect(chunkCount(6000)).toBe(8) // capped
  })

  it('sizes capsules by √(tokens ÷ 500), capped at 4× (D34)', () => {
    expect(capsuleLengthPx(500)).toBeCloseTo(14)
    expect(capsuleLengthPx(2000)).toBeCloseTo(28)
    expect(capsuleLengthPx(8000)).toBe(56)
    expect(capsuleLengthPx(50000)).toBe(56)
    expect(capsuleLengthPx(0)).toBe(7)
  })

  it('swells past the length cap, up to twice as fat, and trails a comet per loop', () => {
    expect(capsuleSwell(2500)).toBe(1)
    expect(capsuleSwell(8000)).toBe(1)
    expect(capsuleSwell(18000)).toBeCloseTo(1.5)
    expect(capsuleSwell(32000)).toBe(2)
    expect(capsuleSwell(200000)).toBe(2)
    expect(cometLengthPx(0)).toBe(0)
    expect(cometLengthPx(3)).toBe(21)
    expect(cometLengthPx(40)).toBe(42)
  })

  it('shades faces toward +z with the left colour and toward +x with the right', () => {
    expect(sideShade(0, 1)).toBe(0)
    expect(sideShade(1, 0)).toBe(1)
    expect(sideShade(Math.SQRT1_2, Math.SQRT1_2)).toBeCloseTo(0.5)
  })
})

describe('camera framing', () => {
  const view = { width: 1440, height: 900, left: 264, right: 288, top: 72, bottom: 168 }
  const margin = 32

  /** Where a world point lands on screen, px, with the camera on (x, 0, z) at this zoom. */
  function onScreen(p: { x: number; y: number; z: number }, frame: { x: number; z: number; zoom: number }) {
    const { right, up } = cameraBasis()
    const du = (p.x - frame.x) * right.x + p.y * right.y + (p.z - frame.z) * right.z
    const dv = (p.x - frame.x) * up.x + p.y * up.y + (p.z - frame.z) * up.z
    return { sx: view.width / 2 + du * frame.zoom, sy: view.height / 2 - dv * frame.zoom }
  }

  it('fits every point inside the area the HUD leaves open, with the margin, touching it on one axis', () => {
    const points = [
      { x: 0.4, y: 0, z: 7.6 },
      { x: 25.6, y: 0, z: 11.4 },
      { x: 12, y: 1.2, z: 6 },
      { x: 13, y: 0, z: 7 },
    ]
    const frame = frameBounds(points, view, margin, 1, 1000)
    const shots = points.map((p) => onScreen(p, frame))
    const xs = shots.map((s) => s.sx)
    const ys = shots.map((s) => s.sy)
    const eps = 1e-6
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(view.left + margin - eps)
    expect(Math.max(...xs)).toBeLessThanOrEqual(view.width - view.right - margin + eps)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(view.top + margin - eps)
    expect(Math.max(...ys)).toBeLessThanOrEqual(view.height - view.bottom - margin + eps)
    const fillsWidth = Math.abs(Math.max(...xs) - Math.min(...xs) - (view.width - view.left - view.right - 2 * margin)) < 1e-6
    const fillsHeight = Math.abs(Math.max(...ys) - Math.min(...ys) - (view.height - view.top - view.bottom - 2 * margin)) < 1e-6
    expect(fillsWidth || fillsHeight).toBe(true)
    // Centred in the open area.
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo((view.left + view.width - view.right) / 2, 6)
  })

  it('stops at the zoom limits', () => {
    const one = [
      { x: 12, y: 0, z: 9 },
      { x: 13, y: 0, z: 10 },
    ]
    expect(frameBounds(one, view, margin, 20, 90).zoom).toBe(90)
    expect(frameBounds([{ x: -40, y: 0, z: -40 }, { x: 80, y: 0, z: 80 }], view, margin, 20, 90).zoom).toBe(20)
  })
})
