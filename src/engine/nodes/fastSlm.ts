/*
 * Fast SLM (Llama 8B): cheap and fast, wrong 40% of the time on complex chat.
 */

import { makeModelBehavior } from './model'

export const fastSlm = makeModelBehavior('FAST_SLM')
