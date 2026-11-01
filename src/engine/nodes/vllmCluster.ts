/*
 * vLLM cluster (D22, J-1): your own GPUs. No price per token and no PII
 * breach, but upkeep by the minute, busy or not. It batches continuously,
 * limited by KV memory (pipeline.ts), and each sequence in the batch slows
 * decoding (model.ts). It loads its weights before it serves anything.
 */

import { makeModelBehavior } from './model'

export const vllmCluster = makeModelBehavior('VLLM_CLUSTER')
