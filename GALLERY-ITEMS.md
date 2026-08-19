# Infinite gallery — item registry

Every tile in the `/book`-style infinite gallery (the CMS section revealed by
clicking into the hero — `.viewport-wrapper[data-viewport-wrapper-cms]` in
`index.html`) has a number and a name here, so it can be referred to in
conversation ("swap item 5", "replace item 2") without re-describing it.
Numbering is one flat sequence across both pinned and cycling tiles — there's
no separate counter per type.

Code lives in `infinite-gallery.js`. The three pinned items also have a
short version of this table as a comment at the top of that file; this is
the full version, including the cycling wallpaper photos and where to edit
each source.

## Pinned tiles

These exist as exactly one instance on screen at a time — pinned into a
fixed slot in the wallpaper rather than cycling like the plain photos below.
Items 1–3: flat / facing-camera at rest, cursor-driven "3D mode" once
clicked into focus. Item 4 (vinyl) is a full port of the `vinylprocess`
project's interactive record, active only while focused: left-drag paints
across 3 layers (same two-mask reveal, same stroke-snapshot trigger),
right-drag orbits (unclamped spin, clamped pitch) — see
`vinyl-reveal.js`'s file header for why this needed an isolated React
root even though the rest of the gallery is plain vanilla JS.

| # | Name | What it is | Current source | Code |
|---|------|-----------|-----------------|------|
| 1 | **vhs** | 3D Sony VHS tape (Three.js + GLTFLoader) | `assets/vhs/sony_vhs_tape.glb` | `VHS_MODEL_SRC`, `setupVhs()`, `vhsTick()` |
| 2 | **stackedlayers** | Click-to-rotate photo stack, 6 frames | 6 picsum placeholders, seeds `infinite-gallery-stack-1`…`6` | `STACK_IMAGES`, `setStackImages()`, `advanceStack()` |
| 3 | **fisheyevideo** | Looping video through a WebGL fisheye lens | `video/gallery-video.mp4` | `VIDEO_SRC`, `setupFisheye()`, `drawFisheyeFrame()` |
| 4 | **vinyl** | Paint-to-reveal 3D vinyl record, ported from `vinylprocess` (Three.js + TSL/WebGPU + an isolated React root for the fluid-paint sim) | `assets/vinyl/vinyl_record.glb` + `reveal-layer1/2/3.png` | `vinyl-reveal.js`, `createVinylReveal()`, `vinylTick()` |

## Cycling wallpaper photos

The plain tiles that tile infinitely across the wallpaper, wrapping both
directions. Three separate stock photos (not three copies of one) — each is
its own picsum.photos seed, so each renders as a genuinely different random
image. Seeds start at 2, not 1 — item 4 vinyl took the seed-1 slot as a
pinned tile instead of a cycling photo.

All three share one array (`IMAGES` in `infinite-gallery.js`, index 0-2
below) — replacing one means editing that seed/URL at its index;
`CAPTIONS` is derived from the same array and would need updating alongside
if the placeholder text should change too.

### Item 5 — wallpaper-2

![item 5 preview](https://picsum.photos/seed/infinite-gallery-2/700/900)

`IMAGES[0]` — seed `infinite-gallery-2` — caption "Project 02"

### Item 6 — wallpaper-3

![item 6 preview](https://picsum.photos/seed/infinite-gallery-3/700/900)

`IMAGES[1]` — seed `infinite-gallery-3` — caption "Project 03"

### Item 7 — wallpaper-4

![item 7 preview](https://picsum.photos/seed/infinite-gallery-4/700/900)

`IMAGES[2]` — seed `infinite-gallery-4` — caption "Project 04"

## Notes

- Items 1–4 don't currently show their `.tile-caption` hover label the way
  5–7 do — `render()` only writes caption text for plain cycling tiles. Say
  the word if you want captions on the pinned tiles too (e.g. "VHS TAPE",
  "PHOTO STACK", "FISHEYE VIDEO", "VINYL RECORD") — small change, just
  hasn't been asked for.
- All sources above except vinyl are placeholders (picsum + the training
  project's stock video). Swapping any of them in is just pointing the
  relevant constant at a real asset path. Vinyl's `.glb` is already a real
  asset, copied over from the `vinylprocess` project.
