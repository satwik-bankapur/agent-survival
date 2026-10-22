/*
 * Build-menu thumbnails: a 64 × 44 isometric drawing of every node type,
 * as SVG markup. A TypeScript port of the generator behind the design's
 * card thumbnails (design/iso.js, `thumb()` and the node drawers), so the
 * cards show the same chipboard forms as the board, including the node
 * types that have no 3D mesh yet.
 *
 * Every form is an extrusion, cylinder or frustum on the 2:1 iso grid
 * (one tile is 64 × 32 px at zoom 1). Faces are shaded by their normal
 * between the chipboard left and right values; tops take the top value.
 */

/** The design's node keys. Later milestones add engine types for the ones past Milestone 1. */
export type ThumbKind =
  | 'firewall'
  | 'pii'
  | 'cache'
  | 'router'
  | 'slm'
  | 'frontier'
  | 'vllm'
  | 'guard'
  | 'prefix'
  | 'vdb'
  | 'bm25'
  | 'rerank'
  | 'memory'
  | 'coord'
  | 'web'
  | 'sandbox'
  | 'hitl'
  | 'tracer'
  | 'judge'
  | 'cron'
  | 'sub'

type Pt = readonly [number, number]
interface Shade {
  readonly top: string
  readonly left: string
  readonly right: string
  readonly hi?: string
}

const C = {
  top: '#BFB49D',
  left: '#A99D86',
  right: '#857A65',
  glyph: '#5F5646',
  copper: '#C27A45',
  acr: '#F3F7FA',
  tube: '#CFE3F2',
  tubeGlow: '#E9F4FF',
  fig: '#F2EFE6',
  lamp: '#FFE2B8',
  faint: '#637E96',
  agent: '#A6E22E',
  adv: '#FF52B4',
  warn: '#FFB43A',
} as const

const CH: Shade = { top: C.top, left: C.left, right: C.right }
const OB: Shade = { top: '#2C2D33', left: '#1C1D21', right: '#131417', hi: '#4a4c55' }
const AC: Shade = { top: '#F3F7FA', left: '#DCE6EE', right: '#BCCAD6', hi: '#ffffff' }

/** Footprint in tiles. */
const FOOTPRINT: Partial<Record<ThumbKind, number>> = { vllm: 2, coord: 2 }

// The view: origin and scale, set per thumbnail before drawing (the generator is synchronous).
let V = { ox: 0, oy: 0, s: 1 }
/** Per-thumbnail suffix for filter ids, so inline SVGs on one page never share an id. */
let ID = ''

const R1 = (n: number) => Math.round(n * 10) / 10
const P = (c: number, r: number, z = 0): Pt => [V.ox + (c - r) * 32 * V.s, V.oy + (c + r) * 16 * V.s - z * V.s]
const pts = (a: readonly Pt[]) => a.map((p) => `${R1(p[0])},${R1(p[1])}`).join(' ')
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
function mix(a: string, b: string, t: number): string {
  const A = rgb(a)
  const B = rgb(b)
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}
const rect = (c0: number, r0: number, w: number, d: number): Pt[] => [
  [c0, r0],
  [c0 + w, r0],
  [c0 + w, r0 + d],
  [c0, r0 + d],
]
const sq = (c: number, r: number, hw: number, hd = hw) => rect(c - hw, r - hd, 2 * hw, 2 * hd)
function circ(c: number, r: number, R: number, n = 28, rot = 0): Pt[] {
  const a: Pt[] = []
  for (let i = 0; i < n; i++) {
    const t = rot + (i / n) * Math.PI * 2
    a.push([c + R * Math.cos(t), r + R * Math.sin(t)])
  }
  return a
}
function cen(g: readonly Pt[]): Pt {
  let c = 0
  let r = 0
  for (const p of g) {
    c += p[0]
    r += p[1]
  }
  return [c / g.length, r / g.length]
}
const poly = (a: readonly Pt[], fill: string, extra = '') => `<polygon points="${pts(a)}" fill="${fill}" ${extra}/>`
const line = (a: Pt, b: Pt, stroke: string, w: number, extra = '') =>
  `<line x1="${R1(a[0])}" y1="${R1(a[1])}" x2="${R1(b[0])}" y2="${R1(b[1])}" stroke="${stroke}" stroke-width="${R1(w * 10) / 10}" stroke-linecap="round" ${extra}/>`
const glow = (big = false) => `filter="url(#${big ? 'gl3' : 'gl'}${ID})"`

/** An extrusion from base outline `gb` at z0 to top outline `gt` at z1, showing only the faces that face the viewer. */
function solid(gb: readonly Pt[], gt: readonly Pt[], z0: number, z1: number, col: Shade = CH, seam = false): string {
  const n = gb.length
  const ce = cen(gb)
  let s = ''
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const a = gb[i]
    const b = gb[j]
    let nx = b[1] - a[1]
    let ny = a[0] - b[0]
    const mx = (a[0] + b[0]) / 2 - ce[0]
    const my = (a[1] + b[1]) / 2 - ce[1]
    if (nx * mx + ny * my < 0) {
      nx = -nx
      ny = -ny
    }
    if (nx + ny <= 1e-9) continue
    const th = (Math.atan2(ny, nx) * 180) / Math.PI
    const f = mix(col.left, col.right, clamp((90 - th) / 90, 0, 1))
    const stroke = seam
      ? `stroke="${f}" stroke-width=".7"`
      : `stroke="${mix(f, '#000000', 0.15)}" stroke-width=".5" stroke-linejoin="round"`
    s += poly([P(a[0], a[1], z0), P(b[0], b[1], z0), P(gt[j][0], gt[j][1], z1), P(gt[i][0], gt[i][1], z1)], f, stroke)
  }
  s += poly(
    gt.map((p) => P(p[0], p[1], z1)),
    col.top,
    `stroke="${col.hi ?? mix(col.top, '#ffffff', 0.3)}" stroke-width=".8" stroke-linejoin="round"`,
  )
  return s
}
const prism = (g: readonly Pt[], z0: number, h: number, col: Shade = CH) => solid(g, g, z0, z0 + h, col)
const cyl = (c: number, r: number, R: number, z0: number, h: number, col: Shade = CH, n = 32) =>
  solid(circ(c, r, R, n), circ(c, r, R, n), z0, z0 + h, col, true)
const faceL = (c0: number, c1: number, r: number, z0: number, z1: number): Pt[] => [P(c0, r, z0), P(c1, r, z0), P(c1, r, z1), P(c0, r, z1)]
const faceR = (r0: number, r1: number, c: number, z0: number, z1: number): Pt[] => [P(c, r0, z0), P(c, r1, z0), P(c, r1, z1), P(c, r0, z1)]

/** A glyph engraved on a top face: `inner` is drawn in tile units (x along c, y along r) and projected flat at height z. */
function engrave(c: number, r: number, z: number, inner: string, col: string = C.glyph): string {
  const [x, y] = P(c, r, z)
  const k = V.s
  const m = `matrix(${R1(32 * k * 100) / 100} ${R1(16 * k * 100) / 100} ${R1(-32 * k * 100) / 100} ${R1(16 * k * 100) / 100} ${R1(x)} ${R1(y)})`
  const shapes = inner.replace(/<(path|circle|rect|polyline|line|ellipse|polygon)/g, '<$1 vector-effect="non-scaling-stroke"')
  return `<g transform="${m}" fill="none" stroke="${col}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${shapes}</g>`
}

function shadow(g: readonly Pt[], h: number, op = 0.5): string {
  let s = ''
  for (const k of [0, 0.5, 1]) {
    const dc = (k * h) / 40
    const dr = (-k * h) / 170
    s += poly(
      g.map((p) => P(p[0] + dc, p[1] + dr, 0)),
      '#02060a',
    )
  }
  return `<g opacity="${op}" filter="url(#sh${ID})">${s}</g>`
}

/** The idle status light: a dim dot in a dark socket. */
function light(p: readonly [number, number, number]): string {
  const [x, y] = P(p[0], p[1], p[2])
  const k = Math.max(V.s, 0.7)
  return `<circle cx="${R1(x)}" cy="${R1(y)}" r="${R1(2.7 * k)}" fill="#0b1520"/><circle cx="${R1(x)}" cy="${R1(y)}" r="${R1(1.8 * k)}" fill="${C.faint}"/>`
}

/** A white scale figure standing at screen point (x, y). */
function figure(x: number, y: number, k: number): string {
  return (
    `<ellipse cx="${R1(x + 1.9 * k)}" cy="${R1(y + 0.4 * k)}" rx="${R1(2.3 * k)}" ry="${R1(0.8 * k)}" fill="#000" opacity=".4"/>` +
    `<rect x="${R1(x - 1.2 * k)}" y="${R1(y - 5.4 * k)}" width="${R1(2.4 * k)}" height="${R1(5.4 * k)}" rx="${R1(1.1 * k)}" fill="${C.fig}"/>` +
    `<rect x="${R1(x + 0.15 * k)}" y="${R1(y - 5.1 * k)}" width="${R1(1.05 * k)}" height="${R1(5 * k)}" rx="${R1(0.5 * k)}" fill="#d3cfc2"/>` +
    `<circle cx="${R1(x)}" cy="${R1(y - 6.75 * k)}" r="${R1(1.15 * k)}" fill="${C.fig}"/>`
  )
}

interface Drawn {
  /** The body. */
  readonly s: string
  /** Height in px at zoom 1, used to fit the thumbnail. */
  readonly h: number
  readonly light: readonly [number, number, number] | null
  /** The emissive layer, drawn over everything with glow. */
  readonly emit?: string
  /** Under the body, after the shadow (the Frontier cloud's ground shadow). */
  readonly base?: string
  /** The shadow outline; a square of the footprint by default. */
  readonly foot?: readonly Pt[]
}

const DRAW: Record<ThumbKind, (c: number, r: number) => Drawn> = {
  firewall(c, r) {
    let s = prism(sq(c, r, 0.42, 0.46), 0, 4)
    for (let i = 0; i < 6; i++) s += prism(rect(c - 0.15, r - 0.4 + i * 0.155, 0.3, 0.06), 4, 16)
    return { s, h: 20, light: [c + 0.42, r + 0.3, 2.5] }
  },
  pii(c, r) {
    const s =
      prism(sq(c, r, 0.38), 0, 22) +
      poly(faceL(c - 0.28, c + 0.28, r + 0.38, 12.5, 14.5), '#2b261e') +
      poly(faceL(c - 0.24, c + 0.1, r + 0.38, 5, 8.5), '#070708') +
      engrave(c, r, 22, '<rect x="-.2" y="-.07" width=".4" height=".14"/>')
    return { s, h: 22, light: [c + 0.38, r + 0.15, 18] }
  },
  cache(c, r) {
    const s = cyl(c, r, 0.4, 0, 14) + engrave(c, r, 14, '<polygon points=".07,-.27 -.12,.03 .01,.03 -.06,.27 .14,-.05 .01,-.05"/>')
    return { s, h: 14, light: [c + 0.28, r + 0.28, 7], foot: circ(c, r, 0.4, 20) }
  },
  router(c, r) {
    const hx = circ(c, r, 0.44, 6, Math.PI / 6)
    let s = prism(hx, 0, 16)
    for (const d of [-55, -18, 18, 55]) {
      const a = (d * Math.PI) / 180
      s += prism(sq(c + 0.47 * Math.cos(a), r + 0.47 * Math.sin(a), 0.06), 5, 6)
    }
    s += engrave(
      c,
      r,
      16,
      '<circle cx="0" cy="0" r=".05"/><line x1="0" y1="0" x2=".22" y2="-.2"/><line x1="0" y1="0" x2=".26" y2="-.06"/><line x1="0" y1="0" x2=".26" y2=".08"/><line x1="0" y1="0" x2=".2" y2=".22"/><circle cx=".27" cy="-.25" r=".04"/><circle cx=".32" cy="-.07" r=".05"/><rect x=".29" y=".06" width=".07" height=".07"/><polyline points=".22,.23 .28,.29 .22,.33"/>',
    )
    return { s, h: 16, light: [c - 0.22, r + 0.38, 10], foot: hx }
  },
  slm(c, r) {
    let s =
      cyl(c, r, 0.36, 0, 4) +
      cyl(c, r, 0.27, 4, 28) +
      cyl(c, r, 0.37, 24, 3, { top: '#cfc5ae', left: '#b6aa92', right: '#8f846e' }) +
      cyl(c, r, 0.22, 32, 3)
    const rp = (a: number) => P(c + 0.37 * Math.cos(a), r + 0.37 * Math.sin(a), 25.5)
    s += `<polyline points="${pts([0, 0.3, 0.6].map((t) => rp(0.2 + t)))}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".8"/>`
    s += `<polyline points="${pts([0, 0.25, 0.5].map((t) => rp(1.3 + t)))}" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width=".8"/>`
    s += engrave(c, r, 35, '<polyline points="-.1,-.08 0,0 -.1,.08"/><polyline points=".02,-.08 .12,0 .02,.08"/>')
    return { s, h: 35, light: [c + 0.19, r + 0.19, 16], foot: circ(c, r, 0.36, 20) }
  },
  frontier(c, r) {
    const k = V.s
    let s = cyl(c, r, 0.3, 0, 3)
    const [x, y] = P(c, r, 42)
    const puffs: [number, number, number][] = [
      [-12, -3, 8],
      [-2, -9, 10],
      [10, -5, 8],
      [17, 0, 5.5],
    ]
    const shapes =
      puffs.map(([a, b, rr]) => `<circle cx="${R1(x + a * k)}" cy="${R1(y + b * k)}" r="${R1(rr * k)}"/>`).join('') +
      `<rect x="${R1(x - 19 * k)}" y="${R1(y - 3 * k)}" width="${R1(41 * k)}" height="${R1(8.5 * k)}" rx="${R1(4.2 * k)}"/>`
    const g = P(c + 0.4, r, 0)
    const base = `<ellipse cx="${R1(g[0])}" cy="${R1(g[1])}" rx="${R1(22 * k)}" ry="${R1(8 * k)}" fill="#000" opacity=".28" filter="url(#sh${ID})"/>`
    s += `<line x1="${R1(x)}" y1="${R1(P(c, r, 3)[1])}" x2="${R1(x)}" y2="${R1(y + 5 * k)}" stroke="${C.acr}" stroke-opacity=".35" stroke-width=".7" stroke-dasharray="1.5 2"/>`
    s += `<g fill="${C.acr}" opacity=".55">${shapes}</g><g filter="url(#edge${ID})" fill="#fff" opacity=".95">${shapes}</g>`
    const ty = y - 18 * k
    const emit = `<rect x="${R1(x + 2 * k)}" y="${R1(ty - 170 * k)}" width="1.1" height="${R1(170 * k)}" fill="url(#teth${ID})"/>`
    return { s, h: 58, light: [c + 0.21, r + 0.21, 1.6], emit, base, foot: circ(c, r, 0.3, 16) }
  },
  vllm(c, r) {
    const k = V.s
    let s = prism(sq(c, r, 0.9), 0, 58, OB)
    for (let i = 0; i < 9; i++) {
      const rr = r - 0.78 + i * 0.195
      s += poly([P(c + 0.9, rr, 8), P(c + 0.97, rr, 8), P(c + 0.97, rr, 52), P(c + 0.9, rr, 52)], mix(C.copper, '#000000', 0.15))
      s += line(P(c + 0.97, rr, 8), P(c + 0.97, rr, 52), '#e09a62', 0.6)
    }
    const mem = 0.5
    s += poly(faceL(c - 0.74, c - 0.62, r + 0.9, 6, 52), '#0a0b0d', 'stroke="#3a3c44" stroke-width=".5"')
    let emit = poly(faceL(c - 0.73, c - 0.63, r + 0.9, 6.5, 6.5 + 45 * mem), C.tubeGlow, `${glow()} opacity=".9"`)
    for (let i = 0; i < 7; i++) {
      const q = P(c - 0.4 + i * 0.15, r + 0.9, 54)
      const on = i < 5
      emit += `<circle cx="${R1(q[0])}" cy="${R1(q[1])}" r="${R1(0.9 * k)}" fill="${on ? C.tubeGlow : '#2b3138'}"${on ? ` ${glow()}` : ''}/>`
    }
    s += engrave(
      c,
      r,
      58,
      '<rect x="-.5" y="-.5" width=".4" height=".4"/><rect x=".1" y="-.5" width=".4" height=".4"/><rect x="-.5" y=".1" width=".4" height=".4"/><rect x=".1" y=".1" width=".4" height=".4"/>',
      '#3e4049',
    )
    return { s, h: 58, light: [c + 0.3, r + 0.9, 54], emit }
  },
  guard(c, r) {
    let s = prism(rect(c - 0.14, r - 0.48, 0.28, 0.16), 0, 26)
    s += poly(
      rect(c - 0.13, r - 0.3, 0.26, 0.6).map((p) => P(p[0], p[1], 13)),
      '#E9F4FF',
      'opacity=".22" stroke="#E9F4FF" stroke-opacity=".6" stroke-width=".7"',
    )
    s += prism(rect(c - 0.14, r + 0.32, 0.28, 0.16), 0, 26) + prism(rect(c - 0.16, r - 0.5, 0.32, 1), 26, 6)
    return { s, h: 32, light: [c + 0.16, r, 29], foot: rect(c - 0.16, r - 0.5, 0.32, 1) }
  },
  prefix(c, r) {
    const s = cyl(c, r, 0.3, 0, 4) + cyl(c, r, 0.24, 4, 9) + `<g opacity=".6">${cyl(c, r, 0.42, 0, 7, AC)}</g>`
    return { s, h: 14, light: null, foot: circ(c, r, 0.42, 20) }
  },
  vdb(c, r) {
    let s = ''
    for (let i = 0; i < 4; i++) {
      const z0 = i * 8
      s += cyl(c, r, 0.4, z0, 6)
      const a = Math.PI / 4
      const gp: Pt = [c + 0.4 * Math.cos(a), r + 0.4 * Math.sin(a)]
      s += line(P(gp[0], gp[1], z0 + 0.8), P(gp[0], gp[1], z0 + 5.2), C.glyph, 1.1)
    }
    s += engrave(c, r, 30, '<circle cx="0" cy="0" r=".06"/>')
    return { s, h: 30, light: [c + 0.28, r + 0.28, 3], foot: circ(c, r, 0.4, 20) }
  },
  bm25(c, r) {
    let s = prism(sq(c, r, 0.4, 0.36), 0, 22)
    const dk = mix(C.left, C.glyph, 0.35)
    const dk2 = mix(C.right, C.glyph, 0.35)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        const c0 = c - 0.34 + i * 0.235
        const z0 = 3 + j * 9
        s += poly(faceL(c0, c0 + 0.2, r + 0.36, z0, z0 + 7), dk)
        const m = P(c0 + 0.1, r + 0.36, z0 + 3.5)
        s += `<circle cx="${R1(m[0])}" cy="${R1(m[1])}" r="${R1(0.9 * V.s)}" fill="#3b352b"/>`
      }
    }
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const r0 = r - 0.3 + i * 0.32
        const z0 = 3 + j * 9
        s += poly(faceR(r0, r0 + 0.26, c + 0.4, z0, z0 + 7), dk2)
      }
    }
    s += engrave(c, r, 22, '<line x1="-.25" y1="-.15" x2=".2" y2="-.15"/><line x1="-.25" y1="0" x2=".25" y2="0"/><line x1="-.25" y1=".15" x2=".1" y2=".15"/>')
    return { s, h: 22, light: [c + 0.4, r + 0.25, 20] }
  },
  rerank(c, r) {
    let s = cyl(c, r, 0.12, 0, 7) + solid(circ(c, r, 0.13, 32), circ(c, r, 0.44, 32), 7, 24, CH, true)
    s += poly(
      circ(c, r, 0.32, 32).map((p) => P(p[0], p[1], 24)),
      '#6a604e',
    )
    return { s, h: 24, light: [c + 0.09, r + 0.09, 3.5], foot: circ(c, r, 0.3, 20) }
  },
  memory(c, r) {
    const k = V.s
    let s = prism(sq(c, r, 0.3, 0.42), 0, 32)
    for (let i = 1; i < 4; i++) s += line(P(c - 0.3, r + 0.42, i * 8), P(c + 0.3, r + 0.42, i * 8), C.glyph, 0.8)
    for (let i = 0; i < 4; i++) s += line(P(c - 0.08, r + 0.42, i * 8 + 4.5), P(c + 0.08, r + 0.42, i * 8 + 4.5), '#4a4336', 1.6 * k)
    s += engrave(c, r, 32, '<polyline points="-.18,.2 -.18,-.25 -.02,-.25 .04,-.18 .18,-.18 .18,.2 -.18,.2"/>')
    return { s, h: 32, light: [c + 0.3, r - 0.2, 28] }
  },
  coord(c, r) {
    const k = V.s
    const R = 0.74
    const z = 20
    let s = cyl(c, r, 0.92, 0, 10, CH, 48)
    const ringP = (a0: number, a1: number, st: number) => {
      const a: Pt[] = []
      for (let t = a0; t <= a1 + 1e-6; t += st) a.push(P(c + R * Math.cos(t), r + R * Math.sin(t), z))
      return a
    }
    const posts = [45, 135, 225, 315].map((d) => (d * Math.PI) / 180)
    const post = (a: number) =>
      line(P(c + R * Math.cos(a), r + R * Math.sin(a), 10), P(c + R * Math.cos(a), r + R * Math.sin(a), z - 2), '#8a8070', 1.4 * k)
    s += post(posts[2]) + post(posts[3]) + post(posts[1])
    s += `<polyline points="${pts(ringP(Math.PI * 0.75, Math.PI * 1.75, 0.1))}" fill="none" stroke="${C.tube}" stroke-opacity=".38" stroke-width="${R1(5 * k)}" stroke-linecap="round"/>`
    s += cyl(c, r, 0.48, 10, 7, CH, 36) + engrave(c, r, 17, '<circle cx="0" cy="0" r=".28"/><circle cx="0" cy="0" r=".12"/>')
    const front = ringP(-Math.PI * 0.25, Math.PI * 0.75, 0.1)
    s += `<polyline points="${pts(front)}" fill="none" stroke="${C.tube}" stroke-opacity=".38" stroke-width="${R1(5 * k)}" stroke-linecap="round"/>`
    s += `<polyline points="${pts(front.map((p): Pt => [p[0], p[1] - 1.6 * k]))}" fill="none" stroke="#E9F4FF" stroke-opacity=".45" stroke-width=".8"/>`
    s += post(posts[0])
    for (const d of [0, 60, 120, 180, 240, 300]) {
      const a = (d * Math.PI) / 180
      if (Math.cos(a) + Math.sin(a) > -0.2) s += prism(sq(c + 0.92 * Math.cos(a), r + 0.92 * Math.sin(a), 0.05), 3, 4)
    }
    const emit = `<polygon points="${pts(ringP(0, Math.PI * 2, 0.1))}" fill="none" stroke="${C.tubeGlow}" stroke-opacity=".25" stroke-width="${R1(1.6 * k)}" ${glow()}/>`
    return { s, h: 26, light: [c + 0.65, r + 0.65, 5], emit, foot: circ(c, r, 0.92, 28) }
  },
  web(c, r) {
    const k = V.s
    let s = prism(sq(c, r, 0.34), 0, 16)
    const a = P(c, r, 16)
    const b = P(c, r, 25)
    s += line(a, b, C.right, 1.6 * k)
    s += `<g transform="translate(${R1(b[0])} ${R1(b[1] - 2 * k)}) rotate(-28)"><ellipse rx="${R1(8 * k)}" ry="${R1(4.6 * k)}" fill="${C.top}" stroke="${C.right}" stroke-width=".8"/><ellipse rx="${R1(5 * k)}" ry="${R1(2.8 * k)}" fill="none" stroke="${C.left}" stroke-width=".7"/>${line([0, 0], [2 * k, -5 * k], C.glyph, 0.8 * k)}</g>`
    return { s, h: 30, light: [c + 0.34, r + 0.15, 12] }
  },
  sandbox(c, r) {
    let s = prism(sq(c, r, 0.2), 2, 14) + engrave(c, r, 16, '<polyline points="-.06,-.12 -.12,0 -.06,.12"/><polyline points=".06,-.12 .12,0 .06,.12"/>')
    s += `<g opacity=".3">${prism(sq(c, r, 0.4), 0, 28, AC)}</g>`
    const g = sq(c, r, 0.4)
    const edges = [1, 2, 3].map((i) => line(P(g[i][0], g[i][1], 0), P(g[i][0], g[i][1], 28), '#fff', 0.7, 'stroke-opacity=".6"')).join('')
    s += `<g fill="none" stroke="#fff" stroke-opacity=".65" stroke-width=".7">${poly(
      g.map((p) => P(p[0], p[1], 28)),
      'none',
    )}${edges}</g>`
    return { s, h: 28, light: [c + 0.4, r + 0.25, 2] }
  },
  hitl(c, r) {
    const k = V.s
    let s = prism(sq(c, r, 0.44), 0, 3) + prism(rect(c - 0.44, r - 0.44, 0.88, 0.06), 3, 22) + prism(rect(c - 0.44, r - 0.44, 0.06, 0.88), 3, 22)
    const f = P(c - 0.2, r - 0.12, 3)
    s += figure(f[0], f[1], k * 0.9)
    s += prism(rect(c - 0.05, r - 0.28, 0.26, 0.24), 3, 7)
    const lp = P(c + 0.12, r - 0.22, 10)
    s += line(lp, [lp[0] + 2 * k, lp[1] - 5 * k], '#3b352b', 0.7 * k)
    s += prism(rect(c + 0.1, r + 0.12, 0.28, 0.24), 3, 2, { top: '#a69a83', left: C.left, right: C.right })
    const emit = `<circle cx="${R1(lp[0] + 2.5 * k)}" cy="${R1(lp[1] - 5.5 * k)}" r="${R1(1.6 * k)}" fill="${C.lamp}" ${glow()}/>`
    return { s, h: 27, light: [c + 0.44, r + 0.3, 1.5], emit }
  },
  tracer(c, r) {
    const k = V.s
    let s = prism(sq(c, r, 0.2), 0, 4) + cyl(c, r, 0.045, 4, 46, CH, 10) + prism(rect(c - 0.11, r - 0.07, 0.22, 0.14), 50, 8)
    const l = P(c, r + 0.07, 54)
    s += `<ellipse cx="${R1(l[0])}" cy="${R1(l[1])}" rx="${R1(2.7 * k)}" ry="${R1(2.5 * k)}" fill="#0c1622" stroke="${C.glyph}" stroke-width=".8"/>`
    s += `<circle cx="${R1(l[0] - 0.8 * k)}" cy="${R1(l[1] - 0.8 * k)}" r="${R1(0.7 * k)}" fill="#cfe3f2" opacity=".8"/>`
    return { s, h: 58, light: [c + 0.11, r, 55] }
  },
  judge(c, r) {
    const k = V.s
    let s = solid(circ(c, r, 0.28, 32), circ(c, r, 0.17, 32), 0, 52, CH, true)
    s += line(P(c - 0.05, r + 0.26, 8), P(c - 0.05, r + 0.24, 0), C.glyph, 1.2)
    s += cyl(c, r, 0.25, 52, 2) + `<g opacity=".7">${cyl(c, r, 0.14, 54, 9, AC)}</g>`
    s += solid(circ(c, r, 0.18, 24), circ(c, r, 0.03, 24), 63, 71, CH, true)
    const L = P(c, r, 58.5)
    const emit = `<circle cx="${R1(L[0])}" cy="${R1(L[1])}" r="${R1(3.2 * k)}" fill="#FFF6E2" ${glow()}/>`
    return { s, h: 72, light: [c + 0.2, r + 0.2, 4], emit, foot: circ(c, r, 0.28, 20) }
  },
  cron(c, r) {
    let s = prism(sq(c, r, 0.32), 0, 30) + solid(sq(c, r, 0.34), sq(c, r, 0.04), 30, 40)
    const face: Pt[] = []
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2
      face.push(P(c + 0.17 * Math.cos(t), r + 0.32, 19 + 6 * Math.sin(t)))
    }
    s += poly(face, '#d6ccb4', 'stroke="#5F5646" stroke-width=".8"')
    s += line(P(c, r + 0.32, 19), P(c, r + 0.32, 23.5), '#3b352b', 0.9) + line(P(c, r + 0.32, 19), P(c + 0.1, r + 0.32, 19), '#3b352b', 0.9)
    return { s, h: 40, light: [c + 0.32, r - 0.15, 26] }
  },
  sub(c, r) {
    let s = prism(sq(c, r, 0.42, 0.36), 0, 14)
    for (let i = 0; i < 5; i++) {
      const rr = r - 0.28 + i * 0.14
      s += poly([P(c + 0.42, rr, 2), P(c + 0.48, rr, 2), P(c + 0.48, rr, 12), P(c + 0.42, rr, 12)], mix(C.right, '#000000', 0.12))
    }
    for (const dc of [-0.24, 0, 0.24]) {
      for (let j = 0; j < 3; j++) s += cyl(c + dc, r - 0.08, 0.075 - j * 0.008, 14 + j * 3.4, 2.6, CH, 12)
      s += cyl(c + dc, r - 0.08, 0.03, 24.2, 3, { top: '#6b6b6b', left: '#4a4a4a', right: '#333' }, 8)
    }
    s += engrave(c + 0.1, r + 0.2, 14, '<polyline points=".04,-.1 -.04,0 .03,0 -.03,.1"/>')
    return { s, h: 28, light: [c - 0.2, r + 0.36, 10] }
  },
}

function defs(): string {
  return (
    `<defs>` +
    `<filter id="sh${ID}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.4"/></filter>` +
    `<filter id="gl${ID}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<filter id="gl3${ID}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<filter id="edge${ID}" x="-100%" y="-100%" width="300%" height="300%"><feMorphology in="SourceAlpha" operator="dilate" radius="1" result="d"/><feComposite in="d" in2="SourceAlpha" operator="out" result="o"/><feFlood flood-color="#ffffff"/><feComposite in2="o" operator="in"/></filter>` +
    `<linearGradient id="teth${ID}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#E9F4FF" stop-opacity=".75"/><stop offset="1" stop-color="#E9F4FF" stop-opacity="0"/></linearGradient>` +
    `</defs>`
  )
}

const cache = new Map<string, string>()

/** The inner markup of a w × h thumbnail of `kind` (defs included), fitted and centred the way the design fits it. */
export function thumbMarkup(kind: ThumbKind, w: number, h: number): string {
  const key = `${kind}${w}x${h}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const fp = FOOTPRINT[kind] ?? 1
  ID = `-${key}`
  // Measure at zoom 1, then fit.
  V = { s: 1, ox: 0, oy: 0 }
  const height = DRAW[kind](0, 0).h + (kind === 'frontier' ? -6 : 0)
  const zoom = Math.min((w - 6) / (fp * 64), (h - 6) / (height + fp * 32))
  const cx = w / 2 + (kind === 'frontier' ? -2 : 0)
  const cy = h - 4 - fp * 16 * zoom
  V = { s: zoom, ox: cx, oy: cy }

  const drawn = DRAW[kind](0, 0)
  const foot = drawn.foot ?? sq(0, 0, (fp / 2) * 0.88)
  const markup =
    defs() +
    shadow(foot, drawn.h * 0.9) +
    (drawn.base ?? '') +
    drawn.s +
    (drawn.emit ?? '') +
    (drawn.light === null ? '' : light(drawn.light))
  cache.set(key, markup)
  return markup
}

export const THUMB_KINDS = Object.keys(DRAW) as ThumbKind[]
