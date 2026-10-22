/*
 * The board, loaded on demand. three.js, drei and postprocessing are most of
 * the bundle, and nothing outside this file imports them at module scope, so
 * Vite gives the scene its own chunk and the title screen paints without it.
 * Its backdrop board then fades in a moment later.
 */

import { lazy, Suspense } from 'react'

import type { IsometricSceneProps } from './IsometricScene'

const Scene = lazy(async () => ({ default: (await import('./IsometricScene')).IsometricScene }))

export function LazyScene(props: IsometricSceneProps) {
  return (
    <Suspense fallback={null}>
      <Scene {...props} />
    </Suspense>
  )
}
