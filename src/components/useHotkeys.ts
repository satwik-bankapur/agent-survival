/*
 * The keyboard (Session 4): V, C, U and X pick tools; 1 to 5 pick tabs; Q to
 * T pick the open tab's cards; Space pauses; [ and ] step the speed; Delete
 * demolishes the selection; ? opens the field guide; Esc peels back one layer
 * (guide, link, card, selection) and otherwise opens the menu. Keys are
 * ignored while typing in a field.
 */

import { useEffect } from 'react'

import { useUiStore, type Tab, type Tool } from '../store/uiStore'
import { formatMoney } from './format'
import { GUIDE } from './guide'
import { CARDS, CARD_KEYS } from './nodeCards'
import { LATER_MILESTONE } from './RightOpsPanels'

const TOOL_KEYS: Readonly<Record<string, Tool>> = { v: 'select', c: 'link', u: 'unlink', x: 'demolish' }

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

/** Picks the open tab's card at `index`, or says why it can't be placed. Pressing it again puts it down. */
function pickCard(index: number): void {
  const s = useUiStore.getState()
  const def = CARDS[s.tab][index]
  if (def === undefined) return
  if (def.nodeType === undefined) {
    s.toast(`${def.name}: ${LATER_MILESTONE.toLowerCase()}`, 'alarm')
    return
  }
  const cost = s.snapshot.prices[def.nodeType].build
  if (s.selectedCard !== def.kind && s.snapshot.money.budget < cost) {
    s.toast(`Needs $${Math.ceil(cost - s.snapshot.money.budget)} more`, 'alarm')
    return
  }
  s.selectCard(s.selectedCard === def.kind ? null : def.kind)
}

export type HotkeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target' | 'preventDefault'>

export function handleHotkey(e: HotkeyEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
  const s = useUiStore.getState()
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const tool = TOOL_KEYS[key]
  if (tool !== undefined) {
    s.setTool(tool)
    return
  }
  if (key >= '1' && key <= '5' && key.length === 1) {
    s.setTab(Number(key) as Tab)
    return
  }
  const card = CARD_KEYS.findIndex((k) => k.toLowerCase() === key)
  if (card >= 0) {
    pickCard(card)
    return
  }
  switch (key) {
    case '?':
      // The selected node's entry if there is one, else the top of the guide.
      s.openHelp(s.selectedNodeId === null ? GUIDE[0].id : (s.snapshot.nodes.find((n) => n.id === s.selectedNodeId)?.type ?? GUIDE[0].id))
      return
    case ' ':
      e.preventDefault()
      s.togglePause()
      return
    case '[':
      s.stepSpeed(-1)
      return
    case ']':
      s.stepSpeed(1)
      return
    case 'Delete':
    case 'Backspace': {
      const node = s.selectedNodeId === null ? undefined : s.snapshot.nodes.find((n) => n.id === s.selectedNodeId)
      if (node === undefined) return
      e.preventDefault()
      s.dispatch({ type: 'demolish', nodeId: node.id }, `Demolished ${node.label}. Refunded ${formatMoney(s.snapshot.prices[node.type].refund)}.`)
      return
    }
    case 'Escape':
      s.escape()
      return
  }
}

export function useHotkeys(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleHotkey)
    return () => window.removeEventListener('keydown', handleHotkey)
  }, [])
}
