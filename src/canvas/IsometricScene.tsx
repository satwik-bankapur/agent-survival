/*
 * The board: an orthographic camera at 30° elevation and 45° yaw over the
 * mat, with MapControls for pan and zoom only. The engine steps from
 * useFrame (D35 guards live in GameEngine.step), before anything reads it.
 *
 * Colours are the design's, unlit and untouched by tone mapping (`flat`);
 * the desk lamp is a warm key light that only casts the soft shadows, plus
 * the design's screen-space lamp glow and vignette laid over the canvas.
 * Only the emissive layer (capsules, status lights) goes above 1.0, so the
 * high-threshold bloom picks out traffic and nothing else.
 */

import { MapControls, OrthographicCamera, Stats } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { Object3D, Vector3, type DirectionalLight, type OrthographicCamera as ThreeOrthographicCamera } from 'three'

import { formatClock, type GameEngine } from '../engine'
import { buildTopology, framePoints, stampTopology, type Topology, type TopologyStamp } from './board'
import { CapsuleSwarm } from './CapsuleSwarm'
import { EngineContext, useEngine } from './engineContext'
import type { FrameRequests } from './devScenes'
import type { FinalFrame } from '../run'
import { HERO_VIEW, MAT_MARGIN, PX_PER_UNIT, ZOOM_RANGE, cameraDirection, frameBounds } from './iso'
import { MatBoard } from './MatBoard'
import { NodeMesh } from './NodeMeshes'
import { PlateLayer, PlateTracker, plateAnchors, type PlateRegistry } from './LabelPlates'
import { BadgeLayer, BoardBadges, type BadgeRegistry } from './BoardBadges'
import { CoachLayer, CoachTracker, type CoachDom } from './CoachMark'
import { MoneyFloatLayer, MoneyFloats, type FloatPool } from './MoneyFloats'
import { createCapsulePicks, type CapsulePicks } from './capsulePicks'
import { Interaction, InteractionLayer, type InteractionDom } from './Interaction'
import { HEX } from './palette'
import { NightShift } from './NightShift'
import { PowerCables } from './PowerCables'
import { TubeSystem } from './TubeSystem'

const CAMERA_DISTANCE = 60

/** The key light's direction toward the lamp: from −x (screen left) and a little +z, 45° up (iso shadow()). */
const LAMP_DIRECTION = new Vector3(-1, 1, 0.24).normalize()

function EngineDriver() {
  const engine = useEngine()
  useFrame((_, delta) => engine.step(delta * 1000), -1)

  // D35: auto-pause while the tab is hidden, and resume only if we paused it.
  useEffect(() => {
    let pausedByUs = false
    const onVisibility = () => {
      if (document.hidden && !engine.paused) {
        engine.paused = true
        pausedByUs = true
      } else if (!document.hidden && pausedByUs) {
        engine.paused = false
        pausedByUs = false
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [engine])
  return null
}

/** The camera keeps this clear between the framed board and the HUD, px. */
const FRAME_MARGIN_PX = 32
/** A re-frame after a scripted build eases over this long, real seconds. */
const FRAME_EASE_SEC = 0.45

/** The HUD's footprint round the screen edges, px: the board is framed in what's left. */
export interface BoardInsets {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * The camera frames the placed nodes when the board mounts (so `?at=` lands framed) and eases to
 * a new frame after each scripted build step. The player's own building never moves it.
 */
function CameraRig({ framing, insets }: { framing: FrameRequests; insets: BoardInsets }) {
  const engine = useEngine()
  const size = useThree((s) => s.size)
  const camera = useRef<ThreeOrthographicCamera>(null)
  const controls = useRef<ComponentRef<typeof MapControls>>(null)
  const { cols, rows } = engine.world.catalog.board
  // The hero's zoom at 1440 × 900, scaled down to fit smaller windows: the zoom range is relative to it.
  const base = PX_PER_UNIT * HERO_VIEW.zoom * Math.min(1, size.width / 1440, size.height / 900)

  const frame = useCallback(
    () =>
      frameBounds(
        framePoints(engine.world),
        { width: size.width, height: size.height, ...insets },
        FRAME_MARGIN_PX,
        base * ZOOM_RANGE.min,
        base * ZOOM_RANGE.max,
      ),
    [engine, size.width, size.height, insets, base],
  )

  // Passed as props, so it holds when drei rebuilds the controls for the new default camera.
  const view = useMemo(() => {
    const f = frame()
    const d = cameraDirection()
    const target: [number, number, number] = [f.x, 0, f.z]
    const position: [number, number, number] = [f.x + d.x * CAMERA_DISTANCE, d.y * CAMERA_DISTANCE, f.z + d.z * CAMERA_DISTANCE]
    return { target, position, zoom: f.zoom }
  }, [frame])

  const seen = useRef(framing.count)
  const ease = useRef<{ from: { x: number; z: number; zoom: number }; to: { x: number; z: number; zoom: number }; t: number } | null>(null)
  const clamped = useMemo(() => new Vector3(), [])
  useFrame((_, delta) => {
    const cam = camera.current
    const ctl = controls.current
    if (cam === null || ctl === null) return
    const t = ctl.target
    if (framing.count !== seen.current) {
      seen.current = framing.count
      ease.current = { from: { x: t.x, z: t.z, zoom: cam.zoom }, to: frame(), t: 0 }
    }
    const e = ease.current
    if (e !== null) {
      e.t = Math.min(1, e.t + delta / FRAME_EASE_SEC)
      const k = smoothstep(e.t)
      const d = cameraDirection()
      t.set(e.from.x + (e.to.x - e.from.x) * k, 0, e.from.z + (e.to.z - e.from.z) * k)
      cam.position.set(t.x + d.x * CAMERA_DISTANCE, d.y * CAMERA_DISTANCE, t.z + d.z * CAMERA_DISTANCE)
      cam.zoom = e.from.zoom + (e.to.zoom - e.from.zoom) * k
      cam.updateProjectionMatrix()
      ctl.update()
      if (e.t >= 1) ease.current = null
    }
    // Keep the view over the mat.
    clamped.set(Math.min(cols + MAT_MARGIN, Math.max(-MAT_MARGIN, t.x)), 0, Math.min(rows + MAT_MARGIN, Math.max(-MAT_MARGIN, t.z)))
    if (clamped.x === t.x && clamped.z === t.z && t.y === 0) return
    cam.position.add(clamped).sub(t)
    t.copy(clamped)
    ctl.update()
  })

  return (
    <>
      <OrthographicCamera makeDefault ref={camera} position={view.position} zoom={view.zoom} near={0.1} far={CAMERA_DISTANCE * 4} />
      <MapControls
        ref={controls}
        makeDefault
        target={view.target}
        enableRotate={false}
        enableDamping={false}
        screenSpacePanning={false}
        minZoom={base * ZOOM_RANGE.min}
        maxZoom={base * ZOOM_RANGE.max}
      />
    </>
  )
}

function KeyLight() {
  const engine = useEngine()
  const light = useRef<DirectionalLight>(null)
  const target = useMemo(() => new Object3D(), [])
  const { cols, rows } = engine.world.catalog.board
  const centre = useMemo(() => new Vector3(cols / 2, 0, rows / 2), [cols, rows])

  useLayoutEffect(() => {
    const l = light.current
    if (l === null) return
    target.position.copy(centre)
    l.target = target
    l.position.copy(centre).addScaledVector(LAMP_DIRECTION, 30)
    const cam = l.shadow.camera
    cam.left = -24
    cam.right = 24
    cam.top = 24
    cam.bottom = -24
    cam.near = 1
    cam.far = 80
    cam.updateProjectionMatrix()
  }, [centre, target])

  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={light}
        color={HEX.lamp}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={4}
      />
    </>
  )
}

function Board({ topology, onTopology, picks }: { topology: Topology; onTopology: (next: Topology) => void; picks: CapsulePicks }) {
  const engine = useEngine()
  const stamp = useRef<TopologyStamp>({ nodes: -1, edges: -1, nextNodeId: -1, nextEdgeId: -1 })
  // Rebuilt only when nodes or links change; per-packet state never goes through React.
  useFrame(() => {
    if (stampTopology(engine.world, stamp.current)) onTopology(buildTopology(engine.world))
  })
  return (
    <>
      <PowerCables topology={topology} />
      <TubeSystem topology={topology} />
      {topology.nodes.map((node) => (
        <NodeMesh key={node.id} node={node} topology={topology} />
      ))}
      <CapsuleSwarm topology={topology} picks={picks} />
    </>
  )
}

/** Dev only: live packets and the clock, written straight into a DOM node a few times a second. */
const READOUT_ID = 'dev-readout'

function DevReadout() {
  const engine = useEngine()
  const since = useRef(0)
  useFrame((_, delta) => {
    since.current += delta
    const el = document.getElementById(READOUT_ID)
    if (el === null || since.current < 0.25) return
    since.current = 0
    const w = engine.world
    el.textContent = `${w.pool.liveCount} live · ${formatClock(w.tick / (1000 / w.catalog.tickMs))}${w.gameOver ? ` · over (${w.gameOver.cause.toLowerCase()})` : ''}`
  })
  return null
}

/** After a run ends, the board holds this long (real seconds) before the postmortem takes over. */
const GAME_OVER_HOLD_SEC = 1.2

/**
 * When the run ends: hold a beat, then grab the final frame (right after the composer has drawn
 * it, in the same frame, so the drawing buffer is still intact) with every node's place in it,
 * and hand both on.
 */
function FinalFrameCapture({ onGameOver }: { onGameOver: (engine: GameEngine, frame: FinalFrame | null) => void }) {
  const engine = useEngine()
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const since = useRef<number | null>(null)
  const done = useRef(false)
  useFrame(({ clock }) => {
    if (done.current || engine.world.gameOver === null) return
    if (since.current === null) since.current = clock.elapsedTime
    if (clock.elapsedTime - since.current < GAME_OVER_HOLD_SEC) return
    done.current = true
    let frame: FinalFrame | null = null
    try {
      const nodeAt = new Map<number, { x: number; y: number }>()
      const p = new Vector3()
      for (const node of engine.world.nodes) {
        p.set(node.x + 0.5, 0, node.y + 0.5).project(camera)
        nodeAt.set(node.id, { x: (p.x * 0.5 + 0.5) * size.width, y: (-p.y * 0.5 + 0.5) * size.height })
      }
      frame = { image: gl.domElement.toDataURL('image/jpeg', 0.85), width: size.width, height: size.height, nodeAt }
    } catch {
      // A tainted or lost context: the postmortem goes without its picture.
    }
    onGameOver(engine, frame)
  }, 2)
  return null
}

export interface IsometricSceneProps {
  readonly engine: GameEngine
  /** Bumped when a scripted build wants the camera to frame the board again. */
  readonly framing: FrameRequests
  readonly insets: BoardInsets
  /** Shows a live-packet readout. */
  readonly dev?: boolean
  /** The FPS meter (Settings, or always in a dev scene). */
  readonly fps?: boolean
  /** The title screen's board: it plays on its own, with no plates, badges or input. */
  readonly backdrop?: boolean
  /** Called once, a beat after the run ends, with its final frame. */
  readonly onGameOver?: (engine: GameEngine, frame: FinalFrame | null) => void
}

const RAYCASTER = { params: { Mesh: {}, Line: { threshold: 0 }, LOD: {}, Points: { threshold: 0 }, Sprite: {} } }

export function IsometricScene({ engine, framing, insets, dev = false, fps = false, backdrop = false, onGameOver }: IsometricSceneProps) {
  // Topology lives out here, so the canvas and the DOM plate layer draw the same board.
  const [topology, setTopology] = useState<Topology>(() => buildTopology(engine.world))
  const anchors = useMemo(() => plateAnchors(topology), [topology])
  const plates = useRef<PlateRegistry>(new Map())
  const badges = useRef<BadgeRegistry>(new Map())
  const floats = useRef<FloatPool>(new Map())
  const [picks] = useState(() => createCapsulePicks(engine.world.pool.size))
  const interaction = useRef<InteractionDom>({ plate: null, badge: null })
  const coach = useRef<CoachDom>({ card: null, leader: null, dot: null })
  return (
    // The right button cancels a tool on the board, so the browser's own menu stays shut.
    <div className="relative h-full w-full bg-desk" onContextMenu={(e) => e.preventDefault()}>
      {/*
        Lines (glyphs, tethers, outlines) never pick: three's default line threshold is one world
        unit, a whole tile, so a neighbour's engraving used to win clicks meant for a node. Tubes pick
        through their mesh sleeves.
      */}
      <Canvas flat shadows="percentage" dpr={[1, 2]} gl={{ antialias: false }} raycaster={RAYCASTER}>
        <EngineContext.Provider value={engine}>
          <color attach="background" args={[HEX.desk]} />
          <EngineDriver />
          <CameraRig framing={framing} insets={insets} />
          <KeyLight />
          <MatBoard />
          <Board topology={topology} onTopology={setTopology} picks={picks} />
          <NightShift />
          {!backdrop && (
            <>
              <PlateTracker anchors={anchors} registry={plates} />
              <BoardBadges topology={topology} registry={badges} insets={insets} />
              <MoneyFloats topology={topology} pool={floats} />
              <Interaction topology={topology} dom={interaction} picks={picks} />
              <CoachTracker dom={coach} plates={plates} />
            </>
          )}
          {onGameOver !== undefined && <FinalFrameCapture onGameOver={onGameOver} />}
          <EffectComposer multisampling={4}>
            <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.7} radius={0.5} />
          </EffectComposer>
          {/* Bottom left, clear of the HUD rails. */}
          {(dev || fps) && !backdrop && <Stats className="top-auto! bottom-9! left-4!" />}
          {dev && <DevReadout />}
        </EngineContext.Provider>
      </Canvas>
      {/* iso.js lays its lamp glow (at 60%) and a vignette over the whole frame, in screen space. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            'radial-gradient(80% 80% at 18% 6%, rgb(255 226 184 / 0.102) 0%, rgb(255 226 184 / 0.03) 50%, transparent 100%)',
            'radial-gradient(95% 95% at 30% 22%, transparent 50%, rgb(0 0 0 / 0.38) 100%)',
          ].join(', '),
        }}
      />
      {!backdrop && (
        <>
          <PlateLayer anchors={anchors} registry={plates} />
          <MoneyFloatLayer pool={floats} />
          <BadgeLayer topology={topology} registry={badges} />
          <InteractionLayer dom={interaction} />
          <CoachLayer dom={coach} catalog={engine.world.catalog} />
        </>
      )}
      {dev && <div id={READOUT_ID} className="type-num pointer-events-none absolute bottom-4 left-4 text-hint text-ink-dim" />}
    </div>
  )
}
