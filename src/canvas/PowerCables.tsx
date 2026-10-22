/*
 * Power cables (iso tube kind 'power'): a dark rubber line on the mat from
 * each substation to the vLLM nodes it powers. The engine runs the cable
 * itself (assignPower, J-1); the player never links one. Rebuilt with the
 * board's topology, x first then y, like every route.
 */

import { useEffect, useMemo } from 'react'
import { BoxGeometry, MeshBasicMaterial, type BufferGeometry } from 'three'

import type { Topology } from './board'
import { useEngine } from './engineContext'
import { PX_XY } from './iso'
import { merge } from './NodeMeshes/geometry'

const WIDTH = 5 * PX_XY
const HEIGHT = 0.012
const cableMaterial = new MeshBasicMaterial({ color: '#0b0c0e' })

/** One straight run between two points on the mat, as a flat box. */
function run(x0: number, z0: number, x1: number, z1: number): BufferGeometry {
  const length = Math.hypot(x1 - x0, z1 - z0) + WIDTH
  const g = new BoxGeometry(x1 !== x0 ? length : WIDTH, HEIGHT, x1 !== x0 ? WIDTH : length)
  g.translate((x0 + x1) / 2, HEIGHT / 2, (z0 + z1) / 2)
  return g
}

export function PowerCables({ topology }: { topology: Topology }) {
  const engine = useEngine()
  const geometry = useMemo(() => {
    const runs: BufferGeometry[] = []
    for (const view of topology.nodes) {
      const node = engine.world.nodeById[view.id]
      const sub = node === undefined || node.powerFromId < 0 ? undefined : engine.world.nodeById[node.powerFromId]
      if (node === undefined || sub === undefined) continue
      const [ax, az, bx, bz] = [sub.x + 0.5, sub.y + 0.5, node.x + 0.5, node.y + 0.5]
      if (ax !== bx) runs.push(run(ax, az, bx, az))
      if (az !== bz) runs.push(run(bx, az, bx, bz))
    }
    return runs.length === 0 ? null : merge(runs)
  }, [engine, topology])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (geometry === null) return null
  return <mesh geometry={geometry} material={cableMaterial} receiveShadow />
}
