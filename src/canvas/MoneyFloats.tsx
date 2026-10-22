/*
 * Money landing: a small "+$5.00" rises over the exit crowd when complex
 * answers earn. Simple chats' 30 cents never float; they'd only be noise.
 *
 * Revenue is coalesced per Users out, so the board stays calm at high
 * traffic: at most one float every 0.6 s of real time, showing everything
 * that landed since the last one ("+$15.00"). A wrong answer pays exactly
 * like a right one (D10), so a float never tells them apart.
 *
 * The floats are a pool of DOM elements written in place from useFrame; the
 * drift and fade are CSS (globals.css .money-float), and reduced motion keeps
 * the fade without the drift.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useState, type RefObject } from 'react'
import { Vector3, type Camera } from 'three'

import { BOARD_EFFECTS_SIZE, BoardEffect, type GameEngine } from '../engine'
import { formatMoney, splitNumberText } from '../components/format'
import type { Topology } from './board'
import { useEngine } from './engineContext'
import { PX_Z } from './iso'

/** Real seconds between floats from one exit. */
export const FLOAT_INTERVAL_SEC = 0.6
/** How long a float lives, real seconds (matches the CSS animation). */
const FLOAT_SEC = 1.2
const POOL = 6
/** Floats start just above the figures, right of the crowd's badge so the two never overlap, px. */
const FLOAT_TOP_PX = 20
const FLOAT_RIGHT_PX = 100

/** Sums what lands and lets it out at most once per interval. */
export class RevenueCoalescer {
  private pending = 0
  private last = -Infinity

  add(amount: number): void {
    this.pending += amount
  }

  /** The amount to show now, or 0 if nothing is due yet. */
  take(nowSec: number): number {
    if (this.pending <= 0 || nowSec - this.last < FLOAT_INTERVAL_SEC) return 0
    const amount = this.pending
    this.pending = 0
    this.last = nowSec
    return amount
  }
}

/** The floats' elements by slot, filled by the DOM layer. */
export type FloatPool = Map<number, HTMLDivElement>

export function MoneyFloatLayer({ pool }: { pool: RefObject<FloatPool> }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: POOL }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            if (el === null) pool.current.delete(i)
            else pool.current.set(i, el)
          }}
          hidden
          className="absolute top-0 left-0"
          style={{ transform: 'translate(-9999px, -9999px)' }}
        >
          <span className="money-float type-num block text-[12px] leading-[14px] font-bold whitespace-nowrap text-ink" />
        </div>
      ))}
    </div>
  )
}

interface Live {
  born: number
  x: number
  y: number
  z: number
}

const scratch = new Vector3()

function writeAmount(el: HTMLDivElement, amount: number): void {
  el.hidden = false
  const span = el.firstElementChild
  if (!(span instanceof HTMLElement)) return
  span.replaceChildren(
    ...splitNumberText(`+${formatMoney(amount)}`).map((run) => {
      if (!run.punct) return document.createTextNode(run.text)
      const punct = document.createElement('span')
      punct.className = 'num-punct'
      punct.textContent = run.text
      return punct
    }),
  )
  // Restart the drift.
  span.classList.remove('money-float')
  void span.offsetWidth
  span.classList.add('money-float')
}

/** Everything a frame does, outside React: read new revenue, spawn due floats, move live ones. */
class FloatPlayer {
  private read: number
  private readonly coalescers = new Map<number, RevenueCoalescer>()
  private readonly live: (Live | null)[] = Array.from({ length: POOL }, () => null)

  constructor(startTotal: number) {
    this.read = startTotal
  }

  frame(engine: GameEngine, topology: Topology, pool: FloatPool, camera: Camera, width: number, height: number, now: number): void {
    const fx = engine.world.effects
    for (let i = Math.max(this.read, fx.total - BOARD_EFFECTS_SIZE); i < fx.total; i++) {
      const at = i % BOARD_EFFECTS_SIZE
      if (fx.kinds[at] !== BoardEffect.REVENUE) continue
      const id = fx.nodeIds[at]
      let c = this.coalescers.get(id)
      if (c === undefined) {
        c = new RevenueCoalescer()
        this.coalescers.set(id, c)
      }
      c.add(fx.amounts[at])
    }
    this.read = fx.total

    // Spawn: one float per exit that has something due, in a free slot or the oldest.
    const slots = this.live
    for (const [id, c] of this.coalescers) {
      const plaza = topology.plazas.get(id)
      if (plaza === undefined) continue
      const amount = c.take(now)
      if (amount <= 0) continue
      let slot = 0
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i]
        if (s === null) {
          slot = i
          break
        }
        const oldest = slots[slot]
        if (oldest !== null && s.born < oldest.born) slot = i
      }
      const el = pool.get(slot)
      if (el === undefined) continue
      slots[slot] = { born: now, x: (plaza.x0 + plaza.x1) / 2, y: FLOAT_TOP_PX * PX_Z, z: (plaza.z0 + plaza.z1) / 2 }
      writeAmount(el, amount)
    }

    // Follow the camera while alive; hide when done.
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]
      const el = pool.get(i)
      if (s === null || el === undefined) continue
      if (now - s.born >= FLOAT_SEC) {
        slots[i] = null
        el.hidden = true
        continue
      }
      scratch.set(s.x, s.y, s.z).project(camera)
      const sx = (scratch.x * 0.5 + 0.5) * width + FLOAT_RIGHT_PX
      const sy = (-scratch.y * 0.5 + 0.5) * height
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`
    }
  }
}

export function MoneyFloats({ topology, pool }: { topology: Topology; pool: RefObject<FloatPool> }) {
  const engine = useEngine()
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  // What landed before the board mounted is old news.
  const [player] = useState(() => new FloatPlayer(engine.world.effects.total))
  useFrame(({ clock }) => player.frame(engine, topology, pool.current, camera, size.width, size.height, clock.elapsedTime))
  return null
}
