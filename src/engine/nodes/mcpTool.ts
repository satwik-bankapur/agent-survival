/*
 * MCP web search and code sandbox (D6, D19, D20). Each call adds its result
 * to the run's next input and hands the run back to its coordinator. Some
 * search results carry a hidden injection the firewall never sees; the code
 * sandbox contains it when the run reaches its code step.
 */

import { msToTicks } from '../catalog'
import { failPacket } from '../outcomes'
import { AgentStep } from '../types'
import { containTaint, returnToCoordinator } from './coordinator'
import type { PipelineBehavior } from './pipeline'

function makeToolBehavior(type: 'MCP_WEB_SEARCH' | 'MCP_CODE_SANDBOX'): PipelineBehavior {
  return {
    type,
    burnsTokens: false,
    serviceTicks(world) {
      return msToTicks(world.catalog, world.catalog.nodes[type].serviceMs)
    },
    complete(world, node, p) {
      // Only runs reach a tool; a demolished coordinator leaves nowhere to return to.
      if (p.coordinatorId < 0) {
        failPacket(world, p, 'NO_ROUTE', node)
        return
      }
      const spec = world.catalog.nodes[type]
      p.newInputTokens += spec.outputTokens
      // A stuck run calls again and again, and gets nowhere.
      if (!p.stuck) p.completedToolSteps++
      // Rolled only for runs at a search, so no other roll stream moves.
      if (spec.taintRate > 0 && world.rng.rolls.chance(spec.taintRate)) p.tainted = true
      if (type === 'MCP_CODE_SANDBOX' && p.tainted) containTaint(world, node)
      p.agentStep = AgentStep.NEXT_MODEL
      returnToCoordinator(world, node, p)
    },
  }
}

export const mcpWebSearch = makeToolBehavior('MCP_WEB_SEARCH')
export const mcpCodeSandbox = makeToolBehavior('MCP_CODE_SANDBOX')
