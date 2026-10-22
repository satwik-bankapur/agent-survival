import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { devParamsFrom } from './canvas/devScenes'
import { startRun, startShared } from './run'
import { sharedFrom } from './share'
import './styles/globals.css'

const container = document.getElementById('root')
if (!container) throw new Error('No #root element in index.html')

// The page opens on the title screen. In dev, `?scene=`, `?seed=` or `?at=` skip it and start a
// run straight away (see src/canvas/devScenes.ts). Engines are made outside React, so StrictMode
// can't build two, and the store is seeded before the board renders.
const dev = devParamsFrom(window.location.search, import.meta.env.DEV)
if (dev !== null) {
  startRun({ mode: 'survival', seed: dev.seed ?? 1, sandbox: { budget: 500, traffic: 1 }, scene: dev.scene, at: dev.at })
} else {
  // A share link (?r= or ?w=), in production too. Decoding is async, so the title screen
  // shows for a frame or two first; a link that doesn't decode just leaves it there.
  void sharedFrom(window.location.search).then((shared) => {
    if (shared !== null) startShared(shared.kind, shared.run)
  })
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
