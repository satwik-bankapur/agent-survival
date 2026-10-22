# Design reference

Put the exported design canvas here, and one image per artboard in `screens/`. Claude Code treats this folder as the visual source of truth and rebuilds it in React and React Three Fiber. Nothing in here gets copied into `src/`.

1. In the design canvas, use Export, then "Download as .zip". Unzip it into this folder.
2. Save one PNG per artboard into `screens/` with these names:

| File | Artboard |
|---|---|
| `01-hero.png` | Hero: Rise of the agents, 6:12 |
| `02-board-language.png` | Board language |
| `03-hud-language.png` | HUD language |
| `04-opening.png` | Opening: Wrapper startup, 1:12 |
| `05-paused-inspecting.png` | Paused and inspecting |
| `06-provider-outage.png` | Provider outage: Enterprise scale, 10:34 |
| `07-trust-critical.png` | Trust critical: Knowledge crisis, 4:02 |
| `08-postmortem.png` | Postmortem |
| `09-title.png` | Title screen |

Long artboards (the two language sheets and the postmortem) can be split into `02-board-language-a.png`, `02-board-language-b.png` and so on.
