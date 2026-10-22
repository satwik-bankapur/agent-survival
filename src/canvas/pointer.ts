/*
 * What the pointer is over, shared by the board's pick targets (nodes,
 * plazas, tubes and the mat) and read by the interaction layer every frame.
 * R3F hands pointer events to the nearest object first, and each target
 * stops propagation, so only the topmost thing under the cursor writes here.
 * Moving from one target to another fires the old one's "out" before the new
 * one's "move", so `inside` ends up true whenever anything is under the cursor.
 *
 * One board per page, so one mutable object: nothing here goes through React.
 */

import type { ThreeEvent } from '@react-three/fiber'

export interface BoardPointer {
  /** Is the pointer over the board at all? */
  inside: boolean
  /** The mat tile under the pointer, or −1 off the grid. */
  tileX: number
  tileY: number
  /** The node under the pointer, or −1. */
  nodeId: number
  /** The tube under the pointer, or −1. */
  edgeId: number
  /** Where the last click landed, in normalised device coordinates (−1 to 1). */
  ndcX: number
  ndcY: number
}

export const boardPointer: BoardPointer = { inside: false, tileX: -1, tileY: -1, nodeId: -1, edgeId: -1, ndcX: 0, ndcY: 0 }

/** A click on the board, after a drag has been ruled out. Set by the interaction layer. */
export const boardClick: { handler: (() => void) | null; cancel: (() => void) | null } = { handler: null, cancel: null }

/** Pointer travel, px, past which a press counts as a pan rather than a click. */
const CLICK_SLOP_PX = 5

function tileOf(e: ThreeEvent<PointerEvent | MouseEvent>, cols: number, rows: number): void {
  const x = Math.floor(e.point.x)
  const y = Math.floor(e.point.z)
  const on = x >= 0 && y >= 0 && x < cols && y < rows
  boardPointer.tileX = on ? x : -1
  boardPointer.tileY = on ? y : -1
}

/** Pointer handlers for a node's meshes (or a plaza): hovering it points at the node and its tile. */
export function nodePickHandlers(nodeId: number, x: number, y: number) {
  return {
    onPointerMove(e: ThreeEvent<PointerEvent>) {
      e.stopPropagation()
      boardPointer.inside = true
      boardPointer.nodeId = nodeId
      boardPointer.edgeId = -1
      boardPointer.tileX = x
      boardPointer.tileY = y
    },
    onPointerOut() {
      boardPointer.inside = false
      if (boardPointer.nodeId === nodeId) boardPointer.nodeId = -1
    },
    onClick: clickHandler,
    onContextMenu: contextHandler,
  }
}

/** Pointer handlers for a tube's pick sleeve. */
export function edgePickHandlers(edgeId: number, cols: number, rows: number) {
  return {
    onPointerMove(e: ThreeEvent<PointerEvent>) {
      e.stopPropagation()
      boardPointer.inside = true
      boardPointer.nodeId = -1
      boardPointer.edgeId = edgeId
      tileOf(e, cols, rows)
    },
    onPointerOut() {
      boardPointer.inside = false
      if (boardPointer.edgeId === edgeId) boardPointer.edgeId = -1
    },
    onClick: clickHandler,
    onContextMenu: contextHandler,
  }
}

/** Pointer handlers for the mat itself: the tile under the pointer, and nothing on it. */
export function matPickHandlers(cols: number, rows: number) {
  return {
    onPointerMove(e: ThreeEvent<PointerEvent>) {
      e.stopPropagation()
      boardPointer.inside = true
      boardPointer.nodeId = -1
      boardPointer.edgeId = -1
      tileOf(e, cols, rows)
    },
    onPointerOut() {
      boardPointer.inside = false
      boardPointer.tileX = -1
      boardPointer.tileY = -1
    },
    onClick: clickHandler,
    onContextMenu: contextHandler,
  }
}

function clickHandler(e: ThreeEvent<MouseEvent>): void {
  e.stopPropagation()
  boardPointer.ndcX = e.pointer.x
  boardPointer.ndcY = e.pointer.y
  if (e.delta > CLICK_SLOP_PX) return
  boardClick.handler?.()
}

function contextHandler(e: ThreeEvent<MouseEvent>): void {
  e.stopPropagation()
  e.nativeEvent.preventDefault()
  boardClick.cancel?.()
}
