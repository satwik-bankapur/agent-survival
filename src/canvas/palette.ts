/*
 * Board colours. Tokens come from src/styles/tokens.css by name, so the
 * board and the HUD can't drift apart; the handful of face colours that
 * design/iso.js derives inline (plaza slab, mat edges, lighter SLM ring,
 * standoffs) are kept here with the iso.js names in comments.
 *
 * three.js Colors are linear; THREE.Color.set() converts from the sRGB hex.
 */

import { Color } from 'three'

function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
  return value === '' ? fallback : value
}

function tokenNumber(name: string, fallback: number): number {
  const value = Number.parseFloat(token(name, String(fallback)))
  return Number.isFinite(value) ? value : fallback
}

const hex = {
  desk: token('desk', '#140f0b'),
  mat: token('mat', '#17324a'),
  matGrid: token('mat-grid', '#2a4d6a'),
  matGrid4: token('mat-grid-4', '#3b6385'),
  matRuler: token('mat-ruler', '#6f93b3'),
  chipTop: token('chipboard-top', '#bfb49d'),
  chipLeft: token('chipboard-left', '#a99d86'),
  chipRight: token('chipboard-right', '#857a65'),
  glyph: token('chipboard-glyph', '#5f5646'),
  acrylic: token('acrylic', '#f3f7fa'),
  glass: token('glass', '#cfe3f2'),
  glassGlow: token('glass-glow', '#e9f4ff'),
  figure: token('figure', '#f2efe6'),
  lamp: token('lamp', '#ffe2b8'),
  ink: token('ink', '#e8eef3'),
  inkDim: token('ink-dim', '#9db2c4'),
  inkFaint: token('ink-faint', '#637e96'),
  pktChat: token('pkt-chat', '#fff2d8'),
  pktRag: token('pkt-rag', '#2bc2ac'),
  pktAgent: token('pkt-agent', '#a6e22e'),
  pktAdv: token('pkt-adv', '#ff52b4'),
  warn: token('warn', '#ffb43a'),
  alarm: token('alarm', '#ff4433'),
} as const

/** sRGB hex strings, for the canvas texture and the HTML label plates. */
export const HEX = {
  ...hex,
  // iso.js mat(): the slab's two visible edges.
  matEdgeLeft: '#10273b',
  matEdgeRight: '#0b1d2c',
  // iso.js PL: the plaza slab.
  plazaTop: '#25405a',
  plazaLeft: '#1b3349',
  plazaRight: '#152a3d',
  // iso.js D.slm: the lighter ring.
  ringTop: '#cfc5ae',
  ringLeft: '#b6aa92',
  ringRight: '#8f846e',
  // iso.js fig(): the shaded side of a figure.
  figureShade: '#d3cfc2',
  // iso.js tube(): standoff post and foot.
  standoff: '#8a8070',
  standoffFoot: '#4c4538',
  // iso.js light(): the status light's bezel.
  bezel: '#0b1520',
  // iso.js shadow().
  shadow: '#02060a',
} as const

export const OPACITY = {
  acrylic: tokenNumber('acrylic-opacity', 0.55),
  glass: tokenNumber('glass-opacity', 0.3),
} as const

export function linear(hexColor: string): Color {
  return new Color().set(hexColor)
}

/**
 * Emissive strength for the glowing layer. These materials skip tone
 * mapping, so anything above 1.0 crosses the bloom threshold and nothing
 * else on the board does (CLAUDE.md: calm model, loud traffic).
 */
export const GLOW = {
  capsule: 1.5,
  light: 3,
} as const
