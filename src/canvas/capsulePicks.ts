/*
 * Where each capsule was drawn last frame, so a click on a paused board can
 * find the one under the pointer (the X-ray). CapsuleSwarm writes it as it
 * fills the instance buffers; preallocated, so the frame loop never allocates.
 */

import { Vector3, type Camera } from 'three'

export interface CapsulePicks {
  count: number
  readonly index: Int32Array
  readonly serial: Float64Array
  readonly xyz: Float32Array
}

export function createCapsulePicks(capacity: number): CapsulePicks {
  return { count: 0, index: new Int32Array(capacity), serial: new Float64Array(capacity), xyz: new Float32Array(capacity * 3) }
}

export function recordPick(picks: CapsulePicks, index: number, serial: number, x: number, y: number, z: number): void {
  const n = picks.count
  if (n >= picks.index.length) return
  picks.index[n] = index
  picks.serial[n] = serial
  picks.xyz[n * 3] = x
  picks.xyz[n * 3 + 1] = y
  picks.xyz[n * 3 + 2] = z
  picks.count = n + 1
}

const scratch = new Vector3()

/** The pick nearest screen point (sx, sy) within `maxPx`, as a slot in `picks`, or -1. */
export function nearestPick(picks: CapsulePicks, camera: Camera, width: number, height: number, sx: number, sy: number, maxPx: number): number {
  let best = -1
  let bestD = maxPx * maxPx
  for (let i = 0; i < picks.count; i++) {
    scratch.set(picks.xyz[i * 3], picks.xyz[i * 3 + 1], picks.xyz[i * 3 + 2]).project(camera)
    const dx = (scratch.x * 0.5 + 0.5) * width - sx
    const dy = (-scratch.y * 0.5 + 0.5) * height - sy
    const d = dx * dx + dy * dy
    if (d <= bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** Starts a new frame's picks. */
export function clearPicks(picks: CapsulePicks): void {
  picks.count = 0
}
