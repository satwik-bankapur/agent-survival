/*
 * A 1440×900 screenshot of a running page, for comparing against
 * design/screens/*.png (CLAUDE.md working rules). An optional WxH sets
 * another viewport.
 *
 *   npm run shot -- <url> <file> [WxH]
 *   npm run shot -- "http://localhost:5173/?scene=full" board.png
 *   npm run shot -- http://localhost:5173/ phone.png 390x844
 *
 * The page must already be served (npm run dev). The shot is taken once the
 * fonts have loaded and a few animation frames have passed, so the R3F scene
 * has rendered and the HUD text is set in its real faces, not the fallbacks.
 * Files land in screenshots/, which is gitignored.
 */

import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { chromium } from 'playwright'

const DEFAULT_VIEWPORT = '1440x900'
/** Frames to wait after fonts load: enough for R3F to mount, render and settle. */
const SETTLE_FRAMES = 10
const OUT_DIR = 'screenshots'

const [url, file, size = DEFAULT_VIEWPORT] = process.argv.slice(2)
const [width, height] = size.split('x').map(Number)
if (!url || !file || !(width > 0 && height > 0)) {
  console.error('Usage: npm run shot -- <url> <file> [WxH]')
  process.exit(1)
}

const path = join(OUT_DIR, basename(file).endsWith('.png') ? basename(file) : `${basename(file)}.png`)
await mkdir(OUT_DIR, { recursive: true })

// Headless Chromium only gets WebGL through SwiftShader, which it now gates behind a flag.
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => console.error(`Page error: ${error.message}`))

  await page.goto(url, { waitUntil: 'load' })
  await page.evaluate(async (frames) => {
    await document.fonts.ready
    for (let i = 0; i < frames; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
  }, SETTLE_FRAMES)

  await page.screenshot({ path })
  console.log(`Saved ${path}`)
} finally {
  await browser.close()
}
