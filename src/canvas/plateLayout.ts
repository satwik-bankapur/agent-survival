/*
 * Label plates never overlap. Each frame the plates are projected to the
 * screen, then placed top to bottom, left to right; a plate that would
 * touch one already placed drops a row below it, and tries again. y only
 * grows, so it always settles. The selected plate is placed first, so it
 * never moves for a neighbour.
 *
 * Pure and allocation-free: the caller owns every array.
 */

/** Plate height and the clear gap kept between plates, px. */
export const PLATE_H = 18
export const PLATE_GAP = 2

export interface PlateLayout {
  /** Centre x, top y and width per plate, px. */
  readonly x: Float32Array
  readonly y: Float32Array
  readonly w: Float32Array
  /** Scratch: placement order. */
  readonly order: Int32Array
  /** Result: each plate's resolved top y. */
  readonly outY: Float32Array
}

export function createPlateLayout(n: number): PlateLayout {
  return { x: new Float32Array(n), y: new Float32Array(n), w: new Float32Array(n), order: new Int32Array(n), outY: new Float32Array(n) }
}

function before(l: PlateLayout, a: number, b: number, first: number): boolean {
  if (a === first) return b !== first
  if (b === first) return false
  return l.y[a] !== l.y[b] ? l.y[a] < l.y[b] : l.x[a] < l.x[b]
}

/** Resolves the first n plates into `outY`; `first` (or −1) is placed before all others. */
export function resolvePlates(l: PlateLayout, n: number, first = -1): void {
  const { order, outY, x, w } = l
  // Insertion sort: a handful of plates, nearly sorted from the frame before.
  for (let i = 0; i < n; i++) {
    let k = i
    while (k > 0 && before(l, i, order[k - 1], first)) {
      order[k] = order[k - 1]
      k--
    }
    order[k] = i
  }
  for (let i = 0; i < n; i++) {
    const a = order[i]
    let y = l.y[a]
    let moved = true
    while (moved) {
      moved = false
      for (let j = 0; j < i; j++) {
        const b = order[j]
        const clearX = Math.abs(x[a] - x[b]) >= (w[a] + w[b]) / 2 + PLATE_GAP
        const clearY = y >= outY[b] + PLATE_H + PLATE_GAP || y + PLATE_H + PLATE_GAP <= outY[b]
        if (!clearX && !clearY) {
          y = outY[b] + PLATE_H + PLATE_GAP
          moved = true
        }
      }
    }
    outY[a] = y
  }
}

/**
 * A plate's stats line: a coordinator's runs ("16 of 16 runs, 9 stuck", I-1), then "+N" past the
 * 12-slot rack (D38). With a tracer, any other queue shows its length ("Queue 3 of 8", hero), which
 * already counts what "+N" would. Empty when there's nothing to say.
 */
export function plateStat(
  runs: { readonly inFlight: number; readonly max: number; readonly stuck: number } | null,
  overflow: number,
  queue: { readonly length: number; readonly capacity: number } | null = null,
): string {
  const parts: string[] = []
  if (runs !== null) parts.push(runs.stuck > 0 ? `${runs.inFlight} of ${runs.max} runs, ${runs.stuck} stuck` : `${runs.inFlight} of ${runs.max} runs`)
  if (runs === null && queue !== null) return `Queue ${queue.length} of ${queue.capacity}`
  if (overflow > 0) parts.push(`+${overflow}`)
  return parts.join(' ')
}
