/*
 * The board's topology, as the canvas draws it: one view per node and per
 * edge, the edges' routes, and the shared arc-length sample buffer (D33).
 * It changes only when the player (or a scenario) places, demolishes, links
 * or unlinks, so it is rebuilt then and never per frame.
 */

import { routeLength, type GameNode, type NodeType, type World } from '../engine'
import { PX_Z } from './iso'
import {
  CORNER_RADIUS,
  SAMPLE_STRIDE,
  SAMPLES_PER_EDGE,
  assignLanes,
  plazaRect,
  polylineLength,
  roundCorners,
  routePolyline,
  sampleByArcLength,
  trimEndToRect,
  trimStartToRect,
  type Pt,
  type Rect,
} from './paths'

/** Height of each node's top, iso px: where hops leave from and land on. */
export const NODE_TOP_PX: Readonly<Record<NodeType, number>> = {
  USERS_IN: 2,
  USERS_OUT: 8,
  FRONTIER_API: 24, // the cloud's base: NodeMeshes/FrontierApi.tsx CLOUD_PX
  FAST_SLM: 35,
  SEMANTIC_CACHE: 18,
  PROMPT_ROUTER: 16,
  OUTPUT_GUARDRAIL: 26,
  PROMPT_FIREWALL: 20,
  PII_REDACTOR: 22,
  VECTOR_DB: 30, // the top disc: NodeMeshes/VectorDb.tsx VECTOR_DB_TOP_PX (the HNSW lattice is open wire)
  BM25_SEARCH: 22,
  RERANKER: 24,
  INGESTION_CRON: 40,
  LANGGRAPH_COORDINATOR: 23, // the orbit track: NodeMeshes/LanggraphCoordinator.tsx COORDINATOR_TOP_PX
  MCP_WEB_SEARCH: 28,
  MCP_CODE_SANDBOX: 28,
  HITL_GATE: 22,
  VLLM_CLUSTER: 50, // NodeMeshes/VllmCluster.tsx VLLM_TOP_PX
  POWER_SUBSTATION: 28, // the insulators: NodeMeshes/PowerSubstation.tsx SUBSTATION_TOP_PX
  TRACER: 58, // the camera head: NodeMeshes/Tracer.tsx TRACER_TOP_PX
  LLM_JUDGE: 72, // the lantern's cap: NodeMeshes/LlmJudge.tsx JUDGE_TOP_PX
}

/** Tube centre height, world units (iso tube z = 7 px). */
export const TUBE_Y = 7 * PX_Z

export interface NodeView {
  readonly id: number
  readonly type: NodeType
  readonly label: string
  readonly x: number
  readonly y: number
}

export interface EdgeView {
  readonly id: number
  readonly from: number
  readonly to: number
  readonly points: readonly Pt[]
  readonly length: number
  /** Index into the sample buffer, in edges. */
  readonly slot: number
  /**
   * A coordinator's two-lane link (D27) is a pair of slimmer tubes side by side: 'out' to what it
   * calls, 'back' for the return, with the brighter rim (design: "Two-lane"). Every other tube is 'single'.
   */
  readonly lanes: 'single' | 'out' | 'back'
}

/** A cache's dotted arc to the Users out its hits fly to (D15). */
export interface CacheArc {
  readonly cacheId: number
  readonly usersOutId: number
}

export interface Topology {
  readonly nodes: readonly NodeView[]
  readonly edges: readonly EdgeView[]
  readonly arcs: readonly CacheArc[]
  /** Users plazas by node id. */
  readonly plazas: ReadonlyMap<number, Rect>
  readonly samples: Float32Array
  /** Edge id → slot, or −1. */
  readonly slotOfEdge: Int32Array
}

/** A cheap fingerprint of the topology, compared every frame without allocating. */
export interface TopologyStamp {
  nodes: number
  edges: number
  nextNodeId: number
  nextEdgeId: number
}

export function stampTopology(world: World, out: TopologyStamp): boolean {
  const changed =
    out.nodes !== world.nodes.length ||
    out.edges !== world.edges.length ||
    out.nextNodeId !== world.nextNodeId ||
    out.nextEdgeId !== world.nextEdgeId
  out.nodes = world.nodes.length
  out.edges = world.edges.length
  out.nextNodeId = world.nextNodeId
  out.nextEdgeId = world.nextEdgeId
  return changed
}

function plazaOf(world: World, node: GameNode): Rect | null {
  if (node.type === 'USERS_IN') return plazaRect('in', node, world.catalog.board.cols)
  if (node.type === 'USERS_OUT') return plazaRect('out', node, world.catalog.board.cols)
  return null
}

/** The Users out nearest a node by route length, ties by id (the engine's nearestUsersOut). */
function nearestUsersOut(world: World, node: GameNode): GameNode | undefined {
  let best: GameNode | undefined
  let bestLength = Infinity
  for (const candidate of world.nodes) {
    if (candidate.type !== 'USERS_OUT') continue
    const length = routeLength(node.x, node.y, candidate.x, candidate.y)
    if (length < bestLength) {
      best = candidate
      bestLength = length
    }
  }
  return best
}

export function buildTopology(world: World): Topology {
  const plazas = new Map<number, Rect>()
  for (const node of world.nodes) {
    const rect = plazaOf(world, node)
    if (rect !== null) plazas.set(node.id, rect)
  }

  const samples = new Float32Array(Math.max(1, world.edges.length) * SAMPLES_PER_EDGE * SAMPLE_STRIDE)
  const slotOfEdge = new Int32Array(world.nextEdgeId + 1).fill(-1)
  const edges: EdgeView[] = []
  // Tubes that share a stretch of grid run side by side in lanes, never through each other.
  const lanes = assignLanes(world.edges.map((edge) => edge.route))
  world.edges.forEach((edge, slot) => {
    const from = world.nodeById[edge.from]
    const to = world.nodeById[edge.to]
    if (from === undefined || to === undefined) return
    let points = routePolyline(edge.route, lanes[slot])
    const fromPlaza = plazas.get(from.id)
    const toPlaza = plazas.get(to.id)
    if (fromPlaza !== undefined) points = trimStartToRect(points, fromPlaza)
    if (toPlaza !== undefined) points = trimEndToRect(points, toPlaza)
    points = roundCorners(points, CORNER_RADIUS)
    sampleByArcLength(points, samples, slot * SAMPLES_PER_EDGE * SAMPLE_STRIDE)
    slotOfEdge[edge.id] = slot
    const lanePair = edge.returnLane
      ? 'back'
      : world.edges.some((e) => e.returnLane && e.from === edge.to && e.to === edge.from)
        ? 'out'
        : 'single'
    edges.push({ id: edge.id, from: edge.from, to: edge.to, points, length: polylineLength(points), slot, lanes: lanePair })
  })

  const arcs: CacheArc[] = []
  for (const node of world.nodes) {
    if (node.type !== 'SEMANTIC_CACHE') continue
    const out = nearestUsersOut(world, node)
    if (out !== undefined) arcs.push({ cacheId: node.id, usersOutId: out.id })
  }

  return {
    nodes: world.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, x: n.x, y: n.y })),
    edges,
    arcs,
    plazas,
    samples,
    slotOfEdge,
  }
}

/** Where a hop leaves from or lands on a node, in world units. */
export function hopAnchor(node: GameNode, out: { x: number; y: number; z: number }): void {
  out.x = node.x + 0.5
  out.z = node.y + 0.5
  out.y = NODE_TOP_PX[node.type] * PX_Z
}

/** Height of a plaza's figures, iso px. */
const FIGURE_TOP_PX = 8

/**
 * The world points the camera frames: each node's footprint on the mat and its top, and each
 * user plaza with its crowd. Plates hang just below the front corners, inside the frame margin.
 */
export function framePoints(world: World): { x: number; y: number; z: number }[] {
  const points: { x: number; y: number; z: number }[] = []
  for (const node of world.nodes) {
    const plaza = plazaOf(world, node)
    const [x0, z0, x1, z1] = plaza === null ? [node.x, node.y, node.x + 1, node.y + 1] : [plaza.x0, plaza.z0, plaza.x1, plaza.z1]
    const top = (plaza === null ? NODE_TOP_PX[node.type] : FIGURE_TOP_PX) * PX_Z
    for (const y of [0, top]) {
      points.push({ x: x0, y, z: z0 }, { x: x1, y, z: z0 }, { x: x0, y, z: z1 }, { x: x1, y, z: z1 })
    }
  }
  return points
}
