/*
 * The engine's only source of randomness (D23): a seeded mulberry32.
 * Same seed, same sequence, on every machine.
 */

/** Mixes a seed and a stream number into a well-spread 32-bit seed. */
export function deriveSeed(seed: number, stream: number): number {
  let h = (seed ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** A float in [0, 1). */
  float(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1))
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p
  }

  /** A float in [min, max). */
  uniform(min: number, max: number): number {
    return min + this.float() * (max - min)
  }

  /** A Poisson draw (Knuth). Large means are split so exp(−λ) never underflows. */
  poisson(lambda: number): number {
    let total = 0
    let remaining = lambda
    while (remaining > 0) {
      const part = remaining > 30 ? 30 : remaining
      remaining -= part
      const limit = Math.exp(-part)
      let k = 0
      let p = this.float()
      while (p > limit) {
        k++
        p *= this.float()
      }
      total += k
    }
    return total
  }

  /** A new generator seeded from this one's seed and a stream number. Doesn't advance this one. */
  fork(stream: number): Rng {
    return new Rng(deriveSeed(this.state, stream))
  }

  getState(): number {
    return this.state
  }
}
