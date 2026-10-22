/*
 * The board's DOM overlays (plates, badges, the ghost's price, the coach
 * mark) are written in place every frame, never through React state. These
 * helpers do the writing, so the components only decide what to show.
 */

/** Stores an element in a ref's slot, from a ref callback. */
export function setSlot<T extends object, K extends keyof T>(slots: T, key: K, value: T[K]): void {
  slots[key] = value
}

/** Shows a plate centred 6 px below screen point (sx, sy), red-edged when `bad`, or hides it when text is null. */
export function showPlate(el: HTMLDivElement | null, text: string | null, bad: boolean, sx: number, sy: number): void {
  if (el === null) return
  if (text === null) {
    if (!el.hidden) el.hidden = true
    return
  }
  el.hidden = false
  if (el.textContent !== text) el.textContent = text
  el.dataset.bad = String(bad)
  el.style.transform = `translate(${sx.toFixed(1)}px, ${(sy + 6).toFixed(1)}px) translateX(-50%)`
}

export function setCursor(el: HTMLElement, cursor: string): void {
  el.style.cursor = cursor
}

/** Moves the coach card to (cardX, cardY) and draws its leader from the anchor (ax, ay); hides all three when off. */
export function placeCoach(
  card: HTMLDivElement,
  leader: SVGPolylineElement,
  dot: SVGCircleElement,
  on: boolean,
  ax: number,
  ay: number,
  cardX: number,
  cardY: number,
  /** Which side of the anchor the card sits on; the leader meets that edge. */
  side: 'left' | 'right' = 'right',
): void {
  const visibility = on ? 'visible' : 'hidden'
  card.style.visibility = visibility
  leader.style.visibility = visibility
  dot.style.visibility = visibility
  if (!on) return
  card.style.transform = `translate(${cardX.toFixed(1)}px, ${cardY.toFixed(1)}px)`
  const edge = side === 'right' ? cardX : cardX + card.offsetWidth
  const bend = side === 'right' ? ax + 20 : ax - 20
  leader.setAttribute('points', `${ax},${ay - 4} ${bend},${cardY + 60} ${edge},${cardY + 60}`)
  dot.setAttribute('cx', String(ax))
  dot.setAttribute('cy', String(ay - 4))
}
