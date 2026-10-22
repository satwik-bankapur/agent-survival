/*
 * Ingestion cron (D45, D46). No links and no pipeline: every 60 s after it's
 * placed, it re-indexes every vector DB on the board, resetting their drift.
 * Runs in step 5 of the tick (D24).
 */

import { ticksPerSecond } from '../catalog'
import type { World } from '../world'

export function runCrons(world: World): void {
  const every = Math.round(world.catalog.nodes.INGESTION_CRON.intervalSec * ticksPerSecond(world.catalog))
  for (let i = 0; i < world.nodes.length; i++) {
    const cron = world.nodes[i]
    if (cron.type !== 'INGESTION_CRON' || world.tick - cron.indexedTick < every) continue
    cron.indexedTick = world.tick
    for (let k = 0; k < world.nodes.length; k++) {
      const node = world.nodes[k]
      if (node.type !== 'VECTOR_DB') continue
      node.indexedTick = world.tick
      // A fresh index clears a drift surge too (J-4).
      node.driftSurge = 0
    }
  }
}
