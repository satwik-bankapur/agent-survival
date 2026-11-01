/*
 * A node type's isometric thumbnail, for build-menu cards and phase cards.
 * The markup comes from our own generator (nodeThumbs.ts), never from
 * outside input, and is cached per type and size.
 */

import { memo } from 'react'

import { thumbMarkup, type ThumbKind } from './nodeThumbs'

export interface NodeThumbProps {
  readonly kind: ThumbKind
  readonly width?: number
  readonly height?: number
}

export const NodeThumb = memo(function NodeThumb({ kind, width = 64, height = 44 }: NodeThumbProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: thumbMarkup(kind, width, height) }}
    />
  )
})
