# Chat Perché

A third-person browser game about a cat-eared kid running across the rooftops of Bordeaux. It's built on
**Three.js r186 with `WebGPURenderer`** and falls back to WebGL 2 automatically.

Everything is procedural: the city, the landmarks, the textures (painted into canvases at startup) and the
character. The game has no external assets.

## Play

| Input | Action |
| --- | --- |
| `W A S D` / arrows | move (camera-relative) |
| Mouse | look (click to capture the pointer) · wheel to zoom |
| `Shift` | sprint |
| `Space` | jump · press again in the air for a flip double-jump |
| Jump into a wall and hold forward | climb (uses stamina, which refills on the ground) |
| `Space` while climbing | wall-jump |
| `R` | back to the start · `M` mute · `Esc` pause |

There are 30 boxes of Pocky hidden around the city: on the streets, on the rooftops, on the basilica, on the
Pont de Pierre and in the Garonne. The golden one is on top of the 114 m Flèche Saint-Michel. The compass at the
top points to the nearest one.

Touch devices get a virtual stick (left side), a look pad (right side), and jump and sprint buttons.

URL flags: `?low` (no MSAA/bloom, 1x pixel ratio) and `?webgl` (force the WebGL 2 backend).

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
```

## Deploy (Vercel)

The repo is ready for Vercel as is. Import it, and the Vite framework preset runs `npm run build` and serves
`dist/` (see `vercel.json`).

## Layout

```
src/
  main.js              boot, render loop, game flow
  core/                rng, merged-geometry batches, AABB physics + spatial hash, input
  world/
    layout.js          world plan (river, bridge, plaza, districts)
    textures.js        canvas-painted facades, roofs, paving, stained glass, the face
    city.js            block/lot generator → chunked merged meshes + colliders
    landmarks.js       Flèche & Basilique Saint-Michel, Pont de Pierre, quays
    environment.js     physical sky + clouds, sun & shadows, ground, TSL river shader
    props.js           plane trees, parked cars, lamps, pigeon flock
  player/
    character.js       the cat kid: toon-shaded rig + procedural animation
    controller.js      movement, double jump, climbing/mantling, swimming
    camera.js          third-person orbit camera with collision
  game/                Pocky hunt, WebAudio sfx
  ui/hud.js            counter, timer, compass, stamina
```
