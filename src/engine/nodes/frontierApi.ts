/*
 * Frontier API: accurate, pays per token, and shares one pool of concurrent
 * calls with every other node on the same provider (D14). pipeline.ts
 * enforces the pool limit through the node's providerIndex.
 */

import { makeModelBehavior } from './model'

export const frontierApi = makeModelBehavior('FRONTIER_API')
