/*
 * The board reads the engine directly inside useFrame (CLAUDE.md), so every
 * canvas component gets the one engine through context instead of props.
 */

import { createContext, useContext } from 'react'

import type { GameEngine } from '../engine'

export const EngineContext = createContext<GameEngine | null>(null)

export function useEngine(): GameEngine {
  const engine = useContext(EngineContext)
  if (engine === null) throw new Error('useEngine needs an EngineContext provider')
  return engine
}
