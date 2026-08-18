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
All three: flat / facing-camera at rest, cursor-driven "3D mode" once
clicked into focus.

| # | Name | What it is | Current source | Code |
|---|------|-----------|-----------------|------|
| 1 | **vhs** | 3D Sony VHS tape (Three.js + GLTFLoader) | `assets/vhs/sony_vhs_tape.glb` | `VHS_MODEL_SRC`, `setupVhs()`, `vhsTick()` |
| 2 | **stackedlayers** | Click-to-rotate photo stack, 6 frames | 6 picsum placeholders, seeds `infinite-gallery-stack-1`…`6` | `STACK_IMAGES`, `setStackImages()`, `advanceStack()` |
| 3 | **fisheyevideo** | Looping video through a WebGL fisheye lens | `video/gallery-video.mp4` | `VIDEO_SRC`, `setupFisheye()`, `drawFisheyeFrame()` |

## Cycling wallpaper photos

The plain tiles that tile infinitely across the wallpaper, wrapping both
directions. Four separate stock photos (not four copies of one) — each is
its own picsum.photos seed, so each renders as a genuinely different random
image. One seed short of a round number on purpose — item 1 vhs took a
slot that would otherwise have been a 5th photo.

All four share one array (`IMAGES` in `infinite-gallery.js`, index 0-3
below) — replacing one means editing that seed/URL at its index;
`CAPTIONS` is derived from the same array and would need updating alongside
if the placeholder text should change too.

### Item 4 — wallpaper-1

![item 4 preview](https://picsum.photos/seed/infinite-gallery-1/700/900)

`IMAGES[0]` — seed `infinite-gallery-1` — caption "Project 01"

### Item 5 — wallpaper-2

![item 5 preview](https://picsum.photos/seed/infinite-gallery-2/700/900)

`IMAGES[1]` — seed `infinite-gallery-2` — caption "Project 02"

### Item 6 — wallpaper-3

![item 6 preview](https://picsum.photos/seed/infinite-gallery-3/700/900)

`IMAGES[2]` — seed `infinite-gallery-3` — caption "Project 03"

### Item 7 — wallpaper-4

![item 7 preview](https://picsum.photos/seed/infinite-gallery-4/700/900)

`IMAGES[3]` — seed `infinite-gallery-4` — caption "Project 04"

## Notes

- Items 1–3 don't currently show their `.tile-caption` hover label the way
  4–7 do — `render()` only writes caption text for plain cycling tiles. Say
  the word if you want captions on the pinned tiles too (e.g. "VHS TAPE",
  "PHOTO STACK", "FISHEYE VIDEO") — small change, just hasn't been asked for.
- All sources above are placeholders (picsum + the training project's stock
  video). Swapping any of them in is just pointing the relevant constant at
  a real asset path.
