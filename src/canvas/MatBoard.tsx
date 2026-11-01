/*
 * The Prussian-blue cutting mat (iso mat()): a 26 × 18 tile grid with a
 * heavier line every 4 tiles, ruler ticks, A–Z and 1–18 grid references,
 * angle guides in the corners, and the desk lamp's soft falloff from the top
 * left, all painted into one canvas texture. Text is drawn once the fonts
 * have loaded, so the references are set in B612 Mono, not a fallback.
 */

import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BoxGeometry, CanvasTexture, MeshBasicMaterial, SRGBColorSpace } from 'three'

import { useEngine } from './engineContext'
import { MAT_MARGIN, MAT_THICKNESS_PX, PX_Z } from './iso'
import { HEX } from './palette'

/** Texture pixels per tile. */
const PPT = 96
/** Screen px per tile along an axis at the hero zoom, to keep line weights true to iso's px. */
const SCREEN_PPT = Math.hypot(32, 16) * 0.95
const PX = PPT / SCREEN_PPT

/**
 * The lamp's centre and reach on the mat, in tiles: iso's lampg gradient sits
 * at 18% across and 6% down the hero frame, which lands off the mat's top-left
 * corner, and reaches about 27 tiles.
 */
const LAMP = { x: -18.5, z: -5.4, radius: 26.8 } as const

function lampStop(alpha: number): string {
  const r = Number.parseInt(HEX.lamp.slice(1, 3), 16)
  const g = Number.parseInt(HEX.lamp.slice(3, 5), 16)
  const b = Number.parseInt(HEX.lamp.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function paintMat(ctx: CanvasRenderingContext2D, cols: number, rows: number, withText: boolean): void {
  const m = MAT_MARGIN
  const w = (cols + 2 * m) * PPT
  const h = (rows + 2 * m) * PPT
  // Tile (c, r) → texture px.
  const X = (c: number) => (c + m) * PPT
  const Y = (r: number) => (r + m) * PPT

  ctx.fillStyle = HEX.mat
  ctx.fillRect(0, 0, w, h)

  const lamp = ctx.createRadialGradient(X(LAMP.x), Y(LAMP.z), 0, X(LAMP.x), Y(LAMP.z), LAMP.radius * PPT)
  lamp.addColorStop(0, lampStop(0.17))
  lamp.addColorStop(0.5, lampStop(0.05))
  lamp.addColorStop(1, lampStop(0))
  ctx.fillStyle = lamp
  ctx.fillRect(0, 0, w, h)

  const line = (c0: number, r0: number, c1: number, r1: number, color: string, widthPx: number) => {
    ctx.strokeStyle = color
    ctx.lineWidth = widthPx * PX
    ctx.beginPath()
    ctx.moveTo(X(c0), Y(r0))
    ctx.lineTo(X(c1), Y(r1))
    ctx.stroke()
  }

  ctx.lineCap = 'round'
  for (let i = 0; i <= cols; i++) line(i, 0, i, rows, i % 4 === 0 ? HEX.matGrid4 : HEX.matGrid, i % 4 === 0 ? 1 : 0.6)
  for (let j = 0; j <= rows; j++) line(0, j, cols, j, j % 4 === 0 ? HEX.matGrid4 : HEX.matGrid, j % 4 === 0 ? 1 : 0.6)

  // Ruler ticks every quarter tile, longer at halves and whole tiles.
  const tick = (q: number) => (q % 4 === 0 ? 0.3 : q % 2 === 0 ? 0.18 : 0.1)
  for (let q = 0; q <= cols * 4; q++) {
    const c = q / 4
    line(c, 0, c, -tick(q), HEX.matRuler, 0.7)
    line(c, rows, c, rows + tick(q), HEX.matRuler, 0.7)
  }
  for (let q = 0; q <= rows * 4; q++) {
    const r = q / 4
    line(0, r, -tick(q), r, HEX.matRuler, 0.7)
    line(cols, r, cols + tick(q), r, HEX.matRuler, 0.7)
  }

  // Angle guides in the four corners: a baseline, a ray at the angle, and an arc between.
  const guide = (c: number, r: number, deg: number) => {
    const a = (deg * Math.PI) / 180
    ctx.strokeStyle = HEX.matRuler
    ctx.lineWidth = 1.3 * PX
    ctx.beginPath()
    ctx.moveTo(X(c), Y(r))
    ctx.lineTo(X(c + 0.95), Y(r))
    ctx.moveTo(X(c), Y(r))
    ctx.lineTo(X(c + 0.95 * Math.cos(a)), Y(r + 0.95 * Math.sin(a)))
    ctx.moveTo(X(c + 0.5), Y(r))
    ctx.arc(X(c), Y(r), 0.5 * PPT, 0, a)
    ctx.stroke()
    if (withText) text(c + 0.62, r + 0.28, `${deg}°`, 6)
  }

  const text = (c: number, r: number, str: string, sizePx: number) => {
    // iso ptext(): set flat on the mat at 1/24 tile per px.
    ctx.fillStyle = HEX.matRuler
    ctx.font = `${(sizePx / 24) * PPT}px "B612 Mono", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(str, X(c), Y(r))
  }

  guide(-m + 0.18, -m + 0.18, 45)
  guide(cols + 0.18, -m + 0.18, 60)
  guide(cols + 0.18, rows + 0.18, 45)
  guide(-m + 0.18, rows + 0.18, 60)

  if (withText) {
    for (let i = 0; i < cols; i++) text(i + 0.5, -0.68, String.fromCharCode(65 + i), 9)
    for (let j = 0; j < rows; j++) text(-0.68, j + 0.5, String(j + 1), 9)
  }
}

/** Paints the mat into its canvas and tells three to re-upload the texture. */
function repaint(texture: CanvasTexture, canvas: HTMLCanvasElement, cols: number, rows: number, withText: boolean): void {
  const ctx = canvas.getContext('2d')
  if (ctx === null) return
  paintMat(ctx, cols, rows, withText)
  texture.needsUpdate = true
}

export function MatBoard() {
  const engine = useEngine()
  const gl = useThree((s) => s.gl)
  const { cols, rows } = engine.world.catalog.board
  const width = cols + 2 * MAT_MARGIN
  const depth = rows + 2 * MAT_MARGIN
  const thickness = MAT_THICKNESS_PX * PX_Z

  const { texture, canvas } = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = Math.round(width * PPT)
    c.height = Math.round(depth * PPT)
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = gl.capabilities.getMaxAnisotropy()
    return { texture: t, canvas: c }
  }, [width, depth, gl])

  useEffect(() => {
    repaint(texture, canvas, cols, rows, false)
    let live = true
    void Promise.all([document.fonts.load(`36px "B612 Mono"`), document.fonts.ready]).then(() => {
      if (live) repaint(texture, canvas, cols, rows, true)
    })
    return () => {
      live = false
    }
  }, [canvas, texture, cols, rows])

  useEffect(() => () => texture.dispose(), [texture])

  // Box faces: +x, −x, +y, −y, +z, −z. The +x face is the slab's right edge on screen, +z its left.
  const materials = useMemo(
    () => [
      new MeshBasicMaterial({ color: HEX.matEdgeRight }),
      new MeshBasicMaterial({ color: HEX.matEdgeRight }),
      new MeshBasicMaterial({ color: HEX.mat }),
      new MeshBasicMaterial({ color: HEX.matEdgeRight }),
      new MeshBasicMaterial({ color: HEX.matEdgeLeft }),
      new MeshBasicMaterial({ color: HEX.matEdgeLeft }),
    ],
    [],
  )
  const top = useMemo(() => new MeshBasicMaterial({ map: texture }), [texture])
  const geometry = useMemo(() => new BoxGeometry(width, thickness, depth), [width, thickness, depth])
  useEffect(
    () => () => {
      geometry.dispose()
      top.dispose()
      for (const mat of materials) mat.dispose()
    },
    [geometry, materials, top],
  )

  const cx = cols / 2
  const cz = rows / 2
  return (
    <group>
      <mesh geometry={geometry} material={materials} position={[cx, -thickness / 2, cz]} />
      {/* A plane's +v runs toward −z once laid flat, so the canvas's top row is the board's far (low-z) edge. */}
      <mesh position={[cx, 0.0005, cz]} rotation={[-Math.PI / 2, 0, 0]} material={top}>
        <planeGeometry args={[width, depth]} />
      </mesh>
      {/* The mat is unlit (its colours are the design's), so shadows land on a plane laid over it. */}
      <mesh position={[cx, 0.001, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <shadowMaterial transparent opacity={0.5} color={HEX.shadow} />
      </mesh>
    </group>
  )
}
