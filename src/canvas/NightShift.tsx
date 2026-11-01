/*
 * The night shift (design: "Provider outage", the board at 30% dimmer): from
 * Enterprise scale (9:00) the study model darkens and only the glowing layer
 * keeps its strength, so traffic, status lights and the judge's lamp read
 * louder. Every material that isn't glowing (toneMapped off marks the glowing
 * layer) has its colour scaled; each keeps its day colour in userData.
 */

import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Color, Mesh, Line, LineSegments, type Material } from 'three'

import { useEngine } from './engineContext'

/** How bright the board is at night, and how long the change takes, seconds. */
const NIGHT = 0.7
const FADE_SEC = 4
/** The phase the night shift starts with: Enterprise scale. */
const NIGHT_PHASE = 3
/** Re-scan the scene this often, frames, so nodes placed at night get dimmed too. */
const RESCAN_FRAMES = 30

interface WithColor extends Material {
  color: Color
}

function hasColor(m: Material): m is WithColor {
  return 'color' in m && (m as { color: unknown }).color instanceof Color
}

export function NightShift() {
  const engine = useEngine()
  const level = useRef(1)
  const applied = useRef(1)
  const frames = useRef(0)

  useFrame(({ scene }, delta) => {
    const w = engine.world
    const phases = w.catalog.phases
    const sec = (w.tick * w.catalog.tickMs) / 1000
    const night = phases.length > NIGHT_PHASE && sec >= phases[NIGHT_PHASE].startSec
    const target = night ? NIGHT : 1
    // A board that opens at night (a load, a retry) starts dark rather than fading.
    if (frames.current === 0) level.current = target
    const step = ((1 - NIGHT) * Math.min(delta, 0.25)) / FADE_SEC
    level.current = target < level.current ? Math.max(target, level.current - step) : Math.min(target, level.current + step)
    frames.current++
    if (level.current === applied.current && (level.current === 1 || frames.current % RESCAN_FRAMES !== 0)) return
    applied.current = level.current
    const k = level.current
    const seen = new Set<Material>()
    const dim = (m: Material) => {
      if (seen.has(m) || m.toneMapped === false || !hasColor(m)) return
      seen.add(m)
      const day = (m.userData.dayColor as Color | undefined) ?? (m.userData.dayColor = m.color.clone())
      m.color.copy(day).multiplyScalar(k)
    }
    scene.traverse((o) => {
      if (!(o instanceof Mesh || o instanceof Line || o instanceof LineSegments)) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) dim(m)
    })
    if (scene.background instanceof Color) {
      const day = (scene.userData.dayBackground as Color | undefined) ?? (scene.userData.dayBackground = scene.background.clone())
      scene.background.copy(day).multiplyScalar(k)
    }
  })
  return null
}
