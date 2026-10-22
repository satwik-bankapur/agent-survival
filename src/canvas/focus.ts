/*
 * Which node the board is focused on, for highlighting its tubes: the node
 * under the pointer, else the selected one. Written by Interaction every
 * frame and read by TubeSystem in useFrame, so hovering never touches React
 * state (CLAUDE.md: the canvas keeps per-frame data out of React).
 */

import { useUiStore } from '../store/uiStore'

export const boardFocus = {
  /** The node under the pointer, or −1. */
  hoveredNodeId: -1,
}

/** The node whose tubes stand out: hovered first, then selected, or −1 for none. */
export function focusedNodeId(): number {
  if (boardFocus.hoveredNodeId >= 0) return boardFocus.hoveredNodeId
  return useUiStore.getState().selectedNodeId ?? -1
}
