# WALKER

> *A very relaxing walk through an infinite neon city.*

**🎮 Play it live: [gabriel-berzescu.github.io/walker](https://gabriel-berzescu.github.io/walker/)**

WALKER is a first-person ambient walking experience set in a rain-soaked cyberpunk
city that generates itself around you as you wander. There are no enemies, no
timers, no fail states — just neon, fog, generative music, and streets that go
on forever.

Jack in. Walk. Chill.

## ✨ What's out there

- **An infinite procedural city** — deterministic, chunk-based generation:
  emissive-window towers, flickering wall signs, neon rooflines, blinking
  beacons, streetlamps, Tron-style street lines, and the occasional quiet plaza
  with a slowly tumbling hologram gem. Walk in any direction for as long as you
  like; the city builds itself ahead of you and dissolves behind you.
- **Real physics** — a [Rapier](https://rapier.rs/) character controller with a
  perfectly steady camera (no head bob — this is a *relaxing* walk), plus
  dynamic **neon cubes** you can shove around, pulse with a click, or conjure
  out of thin air.
- **Shards** — soft green crystals hovering above the streets. Collect them if
  you feel like it. Or don't. They're not going anywhere. (Well, the ones you
  take are — collected shards never respawn.)
- **Generative ambient audio** — no audio files anywhere: slow synth pads
  drifting between chords every 22 seconds through a cavernous feedback delay,
  filtered rain noise, and tiny chimes, all synthesized live with WebAudio.
- **Atmosphere** — rain, exponential fog, stars, a big pale moon, and bloom on
  everything that glows.

## 🕹️ Controls

| Input | Action |
|-------|--------|
| `W A S D` | Walk |
| Mouse | Look |
| `Shift` | Run |
| `Space` | Jump |
| Left click | Pulse the cube you're looking at |
| `Q` | Materialize a new cube |
| `Esc` | Pause (the music gets dreamy and muffled) |
| `P` | Cycle render resolution (if your GPU needs a break) |
| `B` | Toggle bloom |
| `F3` | Diagnostics overlay (FPS, frame times, camera jitter) |

## 🔧 How it works

No build step, no bundler, no `node_modules`. The whole game is vanilla ES
modules loaded straight from a CDN import map — push to `main` and it's live
on GitHub Pages.

| | |
|---|---|
| Rendering | [three.js](https://threejs.org/) + UnrealBloomPass |
| Physics | [@dimforge/rapier3d-compat](https://rapier.rs/) (WASM) |
| Audio | Raw WebAudio, fully generative |
| Build system | none. gloriously none. |

```
index.html      title screen, HUD, import map
js/main.js      boot, render loop, bloom, rain, sky
js/city.js      procedural chunk city (36 m blocks, seeded per chunk)
js/player.js    first-person Rapier character controller
js/props.js     dynamic neon cubes + interactions
js/audio.js     generative ambient engine + sfx
```

The city is split into 36-meter chunks keyed by grid coordinates. Each chunk's
entire contents — building layout, heights, sign colors, flicker phases, shard
placement — comes from a `mulberry32` RNG seeded by a hash of its coordinates,
so the same street corner always looks the same when you come back to it.
Chunks within a radius of the player are instantiated (meshes + static
colliders); anything too far gets removed and disposed. Memory stays flat no
matter how far you roam.

## 🖥️ Running locally

ES modules won't load over `file://`, so serve the folder:

```sh
npx http-server -p 8321 -c-1
# or
python -m http.server 8321
```

Then open `http://localhost:8321` and click **◢ JACK IN ◣**.

---

*Built with 💜 during a late-night pairing session between Gabriel and
[Claude](https://claude.com/claude-code), somewhere in Sector 7.*
