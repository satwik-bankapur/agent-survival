/*
 * Share links. A link carries nothing but the run's seed and its command log,
 * deflated and base64url'd into the URL: the engine is deterministic, so that
 * pair is the whole run (D23).
 *
 *   ?r=<code>   the build, laid down in a sandbox paused at 0:00
 *   ?w=<code>   the run, replayed at its own ticks with the board read-only
 *
 * A link is a stranger's input, so decoding validates every command before the
 * engine sees it, and gives up on anything oversized.
 */

import { NODE_TYPES, type Command, type LoggedCommand, type NodeType, type SettingValue } from './engine'

export type ShareKind = 'build' | 'watch'

/** The URL parameter each kind of link uses. */
export const SHARE_PARAM: Readonly<Record<ShareKind, string>> = { build: 'r', watch: 'w' }

export interface SharedRun {
  readonly seed: number
  readonly log: readonly LoggedCommand[]
}

/** Caps on what a link may carry, so a hostile one can't cost more than a glance. */
const MAX_CODE_CHARS = 32_000
const MAX_JSON_CHARS = 512_000
const MAX_COMMANDS = 4_000

const SEED_MAX = 0xffffff

interface Wire {
  readonly s: number
  readonly l: readonly [number, Command][]
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return await new Response(stream).text()
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(code: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return null
  try {
    const binary = atob(code.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Validation: everything a link claims, checked before the engine sees it
// ---------------------------------------------------------------------------

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= 0xffffffff
}

function isSettingValue(v: unknown): v is SettingValue {
  return (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string' || typeof v === 'boolean'
}

function parseCommand(v: unknown): Command | null {
  if (typeof v !== 'object' || v === null) return null
  const c = v as Record<string, unknown>
  switch (c.type) {
    case 'placeNode':
      return typeof c.nodeType === 'string' && (NODE_TYPES as readonly string[]).includes(c.nodeType) && isInt(c.x) && isInt(c.y)
        ? { type: 'placeNode', nodeType: c.nodeType as NodeType, x: c.x, y: c.y }
        : null
    case 'demolish':
      return isInt(c.nodeId) ? { type: 'demolish', nodeId: c.nodeId } : null
    case 'link':
      return isInt(c.from) && isInt(c.to) ? { type: 'link', from: c.from, to: c.to } : null
    case 'unlink':
      return isInt(c.from) && isInt(c.to) ? { type: 'unlink', from: c.from, to: c.to } : null
    case 'setSetting':
      // The engine checks the key and value against the node; this only checks their shape.
      return isInt(c.nodeId) && typeof c.key === 'string' && c.key.length <= 40 && isSettingValue(c.value)
        ? { type: 'setSetting', nodeId: c.nodeId, key: c.key, value: c.value }
        : null
    case 'endRun':
      return { type: 'endRun' }
    default:
      return null
  }
}

function parseRun(json: string): SharedRun | null {
  let wire: unknown
  try {
    wire = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof wire !== 'object' || wire === null) return null
  const { s, l } = wire as Partial<Wire>
  if (!isInt(s) || s < 0 || s > SEED_MAX || !Array.isArray(l) || l.length > MAX_COMMANDS) return null
  const log: LoggedCommand[] = []
  for (const entry of l) {
    if (!Array.isArray(entry) || entry.length !== 2) return null
    const [tick, raw] = entry as [unknown, unknown]
    const command = parseCommand(raw)
    if (!isInt(tick) || tick < 0 || command === null) return null
    log.push({ tick, command })
  }
  return { seed: s, log }
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export async function encodeShare(run: SharedRun): Promise<string> {
  const wire: Wire = { s: run.seed, l: run.log.map((e) => [e.tick, e.command]) }
  return toBase64Url(await deflate(JSON.stringify(wire)))
}

export async function decodeShare(code: string): Promise<SharedRun | null> {
  if (code.length === 0 || code.length > MAX_CODE_CHARS) return null
  const bytes = fromBase64Url(code)
  if (bytes === null) return null
  let json: string
  try {
    json = await inflate(bytes)
  } catch {
    return null
  }
  return json.length > MAX_JSON_CHARS ? null : parseRun(json)
}

/** The link to copy: this page, with the run in its query. */
export function shareUrl(kind: ShareKind, code: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}?${SHARE_PARAM[kind]}=${code}`
}

/** The shared run this page was opened with, if any. */
export async function sharedFrom(search: string): Promise<{ readonly kind: ShareKind; readonly run: SharedRun } | null> {
  const params = new URLSearchParams(search)
  for (const kind of ['build', 'watch'] as const) {
    const code = params.get(SHARE_PARAM[kind])
    if (code === null) continue
    const run = await decodeShare(code)
    return run === null ? null : { kind, run }
  }
  return null
}
