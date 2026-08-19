import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createVinylReveal } from "./vinyl-reveal.js";

// ---------------------------------------------------------------------
// Pinned tile registry -- one-off special tiles pinned into the wallpaper
// (each exists as exactly one instance on screen, never cycled like the
// plain IMAGES set below). Named here so they can be referred to by name
// in conversation/planning without digging through variable names. Full
// item list, including the cycling wallpaper photos, in GALLERY-ITEMS.md.
//
//   item 1 vhs            -- 3D VHS tape (Three.js + GLTFLoader), flat/
//                             facing-camera at rest, cursor-tilt 3D mode
//                             once focused (same pattern as item 2 below)
//                             code: isVhs / vhsTile / setupVhs()
//   item 2 stackedlayers  -- click-to-rotate photo stack
//                             code: isStack / stackTile / setStackImages()
//   item 3 fisheyevideo   -- looping video through a WebGL fisheye lens
//                             code: isVideo / videoTile / setupFisheye()
//   item 4 vinyl          -- 3D vinyl record with the same paint-to-reveal
//                             mask mechanism and manual orbit as the
//                             vinylprocess project (left-drag paints
//                             across 3 layers, right-drag orbits,
//                             unclamped spin / clamped pitch), active only
//                             while focused. Ported to vanilla JS in
//                             vinyl-reveal.js -- see createVinylReveal()
//                             code: isVinyl / vinylTile / createVinylReveal()
// ---------------------------------------------------------------------

(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------

  // Replace with your own image URLs. The gallery tiles this set into an
  // infinite wallpaper, cycling through it both horizontally and vertically.
  // Seeds start at 2, not 1 -- item 4 vinyl took the seed-1 slot as a
  // pinned tile instead of a cycling photo (unlike item 1 vhs's mention of
  // this above, which is flavor text only; this one's real -- IMAGE_COUNT
  // actually dropped from 4 to 3).
  const IMAGE_COUNT = 3;
  const IMAGES = Array.from(
    { length: IMAGE_COUNT },
    (_, i) => `https://picsum.photos/seed/infinite-gallery-${i + 2}/700/900`
  );
  const CAPTIONS = IMAGES.map((_, i) => `Project ${String(i + 2).padStart(2, "0")}`);

  // One tile in the wallpaper is a click-to-rotate photo stack instead of a
  // normal cycling tile: it has its own image set, and once focused (see
  // Photo stack below), each further click shuffles it to the next frame.
  const STACK_IMAGE_COUNT = 6;
  const STACK_IMAGES = Array.from(
    { length: STACK_IMAGE_COUNT },
    (_, i) => `https://picsum.photos/seed/infinite-gallery-stack-${i + 1}/700/900`
  );
  const STACK_TRANSITION_MS = 420; // must match the CSS transition duration for .stack-exit/.stack-enter

  const STACK_BASE_TILT = 45; // deg, resting rotateY -- must match the CSS default on .stack-3d
  const STACK_TILT_RANGE = 18; // deg each way the cursor can pull it off the base (a hard clamp, not a full spin)

  // A second pinned tile (same one-fixed-slot trick as the photo stack, see
  // above) plays a looping video with a WebGL fisheye/lens-bulge distortion
  // instead of a normal cycling photo. It's pinned rather than substituted
  // into the IMAGES cycle so only one video ever decodes and renders at a
  // time -- IMAGES tiles can show the same picture in several places at
  // once as the wallpaper wraps, which would mean several simultaneous
  // video+WebGL instances of the same clip if it were just another IMAGES
  // entry.
  const VIDEO_SRC = "video/gallery-video.mp4";
  const FISHEYE_POWER = 1.9; // >1 magnifies/bulges the center and compresses toward the edge; <1 would pinch instead
  const FISHEYE_RADIUS = 0.75; // normalized tile-space radius the bulge falls off within
  const FISHEYE_CENTER_LERP = 0.12; // how quickly the bulge glides towards the tracked cursor position

  // A third pinned tile (item 1 vhs) renders a real 3D model -- a Sony VHS
  // tape GLB -- in its own Three.js scene. Same resting-vs-3D-mode split as
  // the stack below: flat/facing-camera until focused, cursor-driven tilt
  // ("3D mode") only once selected.
  const VHS_MODEL_SRC = "assets/vhs/sony_vhs_tape.glb";
  const VHS_TARGET_SIZE = 0.4; // model is rescaled so its largest dimension equals this, in Three.js scene units
  const VHS_TILT_RANGE = 0.5; // rad each way the cursor can lean it off resting, once focused
  const VHS_TILT_LERP = 0.08; // how quickly the tilt eases towards the cursor-driven target (and back to resting when unfocused)

  // A fourth pinned tile (item 4 vinyl) is the full paint-to-reveal vinyl
  // record ported from the vinylprocess project (see vinyl-reveal.js) --
  // left-drag paints across 3 layers, right-drag orbits (unclamped spin,
  // clamped pitch), both only while this tile is focused.
  const VINYL_MODEL_SRC = "assets/vinyl/vinyl_record.glb";
  const VINYL_LAYER1_SRC = "assets/vinyl/reveal-layer1.png";
  const VINYL_LAYER2_SRC = "assets/vinyl/reveal-layer2.png";
  const VINYL_LAYER3_SRC = "assets/vinyl/reveal-layer3.png";

  const DESKTOP_TILE_W = 300; // visible image width
  const DESKTOP_TILE_H = 380; // visible image height
  const MOBILE_TILE_W = 200;
  const MOBILE_TILE_H = 260;

  const MOBILE_BREAKPOINT = 768; // viewport width at/below which mobile spacing kicks in
  const DESKTOP_GAP = 300;
  const DESKTOP_PADDING = 40; // outer breathing room between the column block and the viewport edge
  const MOBILE_GAP = 90;
  const MOBILE_PADDING = 16;

  // Tile size, gap, and padding (and the cell pitch derived from them) all
  // depend on viewport width, so they're recomputed in applyBreakpoint() on
  // every buildGrid() pass rather than fixed constants.
  let TILE_W = DESKTOP_TILE_W;
  let TILE_H = DESKTOP_TILE_H;
  let GAP = DESKTOP_GAP;
  let PADDING = DESKTOP_PADDING;
  let CELL_W = TILE_W + GAP; // grid pitch (image + gap)
  let CELL_H = TILE_H + GAP;

  function applyBreakpoint() {
    const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    TILE_W = isMobile ? MOBILE_TILE_W : DESKTOP_TILE_W;
    TILE_H = isMobile ? MOBILE_TILE_H : DESKTOP_TILE_H;
    GAP = isMobile ? MOBILE_GAP : DESKTOP_GAP;
    PADDING = isMobile ? MOBILE_PADDING : DESKTOP_PADDING;
    CELL_W = TILE_W + GAP;
    CELL_H = TILE_H + GAP;
  }

  // Each column is pushed down a bit further than the one before it, then
  // resets, so columns form a repeating staircase instead of a flat grid.
  // Offsetting only Y per-column (never X) keeps the wrap-around math below
  // untouched -- it still tiles seamlessly, just on a diagonal. Column count
  // is viewport-driven, so every column always gets its own step (stagger
  // cycle length == column count, recomputed in buildGrid()).

  const LERP_FACTOR = 0.09; // easing towards target position each frame
  const FRICTION = 0.94; // momentum decay after release
  const MIN_VELOCITY = 0.02; // velocity floor before we snap to zero
  const MAX_VELOCITY = 90; // clamp so a fast flick can't send it flying
  const WHEEL_MULTIPLIER = 1; // scroll-wheel sensitivity

  const FOCUS_SCALE = 1.1; // focused tile grows by 10%
  const FOCUS_TRANSITION_MS = 600; // must match the CSS transition duration below
  const FOCUS_EXIT_MARGIN = 60; // extra px past the edge so exits fully clear the viewport

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  const galleryEl = document.getElementById("gallery");
  const canvasEl = document.getElementById("canvas");
  const hintEl = document.getElementById("hint");
  const coordsEl = document.getElementById("coords");

  const pos = { x: 0, y: 0 }; // current rendered (eased) position
  const target = { x: 0, y: 0 }; // where we're easing towards
  const velocity = { x: 0, y: 0 }; // momentum after release / flick

  let isDragging = false;
  let hasMoved = false;
  let pointerId = null;
  let startPointer = { x: 0, y: 0 };
  let startTarget = { x: 0, y: 0 };
  let lastPointer = { x: 0, y: 0, t: 0 };

  let cols = 0;
  let rows = 0;
  let offsetX = 0; // horizontal offset that centers the column block in the viewport
  let tiles = []; // { el, img, caption, col, row, lastIndex, curX, curY }

  let isFocused = false; // wallpaper simulation freezes while true
  let focusedTile = null;
  let unfocusTimer = null;

  let stackTile = null; // the single tile designated as the photo stack
  let stackIndex = 0; // which STACK_IMAGES frame it's currently showing
  let stackAnimating = false; // debounce clicks mid-shuffle
  let stackShuffleTimer = null;

  let videoTile = null; // the single tile designated as the fisheye video
  let videoEl = null; // the <video> feeding the WebGL texture
  let fisheye = null; // { gl, program, texture, uniforms } for videoTile's canvas, or null if WebGL is unavailable
  let lastVideoTime = 0; // carried across buildGrid() rebuilds so a resize doesn't restart the clip
  const fisheyeCenter = { x: 0.5, y: 0.5 }; // current (eased) bulge center, normalized tile-space, y=0 at top
  const fisheyeTarget = { x: 0.5, y: 0.5 }; // where it's easing towards -- cursor position while focused, center otherwise

  let vhsTile = null; // the single tile designated as item 1 vhs
  let vhsThree = null; // { renderer, scene, camera, group } for vhsTile's canvas, or null once disposed
  const vhsTiltCurrent = { x: 0, y: 0 }; // current (eased) lean, radians
  const vhsTiltTarget = { x: 0, y: 0 }; // where it's easing towards -- cursor-driven while focused, resting (0,0) otherwise

  let vinylTile = null; // the single tile designated as item 4 vinyl
  let vinylReveal = null; // { tick, dispose } handle from createVinylReveal(), or null once disposed

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  const mod = (n, m) => ((n % m) + m) % m;
  const lerp = (a, b, t) => a + (b - a) * t;

  // Every column just cycles straight through the full image set as it
  // scrolls (offset by its own column index so neighboring columns aren't
  // in lockstep). Since scrolling is vertical-only, this guarantees each
  // of the 5 images surfaces in every column at least once per cycle.
  function imageIndexFor(logicalCol, logicalRow) {
    return mod(logicalRow + logicalCol, IMAGE_COUNT);
  }

  // ---------------------------------------------------------------------
  // Grid construction
  // ---------------------------------------------------------------------

  function buildGrid() {
    applyBreakpoint();

    canvasEl.innerHTML = "";
    tiles = [];

    // Vertical buffer ring so rows wrapping back in from the opposite edge are
    // never visible popping in. Horizontal never scrolls, so columns just need
    // to fill the viewport width exactly -- no buffer required there.
    rows = Math.ceil(window.innerHeight / CELL_H) + 3;
    cols = Math.max(1, Math.floor((window.innerWidth - 2 * PADDING + GAP) / CELL_W));

    const contentW = cols * TILE_W + (cols - 1) * GAP;
    offsetX = Math.max(PADDING, (window.innerWidth - contentW) / 2);

    // Pick one fixed slot in the tile buffer (roughly centered) to be the
    // photo stack, so exactly one instance of it ever exists on screen at a
    // time as it scrolls through, rather than one per column per cycle.
    const stackCol = Math.min(cols - 1, Math.floor(cols / 2));
    const stackRow = Math.floor(rows / 2);
    stackTile = null;

    // Second pinned slot for the fisheye video -- offset from the stack's
    // row so the two never land on the same tile (see the VIDEO_SRC comment
    // above for why this is pinned rather than folded into IMAGES).
    const videoCol = mod(stackCol + 1, cols);
    const videoRow = mod(stackRow + Math.max(1, Math.ceil(rows / 2)), rows);
    videoTile = null;
    videoEl = null;
    fisheye = null;
    fisheyeCenter.x = fisheyeTarget.x = 0.5;
    fisheyeCenter.y = fisheyeTarget.y = 0.5;

    // Third pinned slot for item 1 vhs -- same column as the stack (rows
    // always outnumber the 3 pinned tiles by a wide margin, see `rows`
    // above), row nudged forward until it clears both the stack's and the
    // video's rows so all three land on distinct cells.
    const vhsCol = stackCol;
    let vhsRow = mod(stackRow + 1, rows);
    if (vhsRow === videoRow) vhsRow = mod(vhsRow + 1, rows);
    if (vhsRow === stackRow) vhsRow = mod(vhsRow + 1, rows);
    if (vhsThree) vhsThree.renderer.dispose(); // release the old tile's WebGL context before buildGrid() drops its canvas
    vhsTile = null;
    vhsThree = null;
    vhsTiltCurrent.x = vhsTiltTarget.x = 0;
    vhsTiltCurrent.y = vhsTiltTarget.y = 0;

    // Fourth pinned slot for item 4 vinyl -- same column as the others,
    // row nudged forward until it clears the stack's, video's, and vhs's
    // rows so all four land on distinct cells.
    const vinylCol = stackCol;
    let vinylRow = mod(stackRow + 2, rows);
    if (vinylRow === videoRow) vinylRow = mod(vinylRow + 1, rows);
    if (vinylRow === vhsRow) vinylRow = mod(vinylRow + 1, rows);
    if (vinylRow === stackRow) vinylRow = mod(vinylRow + 1, rows);
    if (vinylReveal) vinylReveal.dispose(); // release the old tile's renderer/React root before buildGrid() drops its canvas
    vinylTile = null;
    vinylReveal = null;

    const frag = document.createDocumentFragment();

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const isStack = i === stackCol && j === stackRow;
        const isVideo = !isStack && i === videoCol && j === videoRow;
        const isVhs = !isStack && !isVideo && i === vhsCol && j === vhsRow;
        const isVinyl = !isStack && !isVideo && !isVhs && i === vinylCol && j === vinylRow;

        const el = document.createElement("div");
        el.className = isStack
          ? "tile stack"
          : isVideo
            ? "tile video"
            : isVhs
              ? "tile vhs"
              : isVinyl
                ? "tile vinyl"
                : "tile";
        el.style.width = `${TILE_W}px`;
        el.style.height = `${TILE_H}px`;

        const inner = document.createElement("div");
        inner.className = "tile-inner";

        const caption = document.createElement("div");
        caption.className = "tile-caption";

        let img = null;
        let stack3d = null;
        let back1 = null;
        let back2 = null;
        let video = null;
        let fisheyeCanvas = null;
        let vhsCanvas = null;
        let vinylCanvas = null;
        let vinylFluidWrapper = null;

        if (isStack) {
          img = document.createElement("img");
          img.draggable = false;
          img.decoding = "async";

          // Cards sit aligned on top of each other (same X/Y), offset only
          // in Z, so tilting the whole group in 3D is what fans them out
          // into a visible cascade instead of a flat 2D scatter.
          stack3d = document.createElement("div");
          stack3d.className = "stack-3d";

          back2 = document.createElement("div");
          back2.className = "stack-card back-2";
          back1 = document.createElement("div");
          back1.className = "stack-card back-1";

          stack3d.appendChild(back2);
          stack3d.appendChild(back1);
          stack3d.appendChild(img);
          inner.appendChild(stack3d);
        } else if (isVideo) {
          // The <video> itself is just a decode source (kept transparent,
          // see .video-fisheye-source) -- drawFisheyeFrame() copies each of
          // its frames into the canvas through the fisheye shader.
          video = document.createElement("video");
          video.className = "video-fisheye-source";
          video.src = VIDEO_SRC;
          video.loop = true;
          video.muted = true;
          video.playsInline = true;
          video.autoplay = true;
          video.preload = "auto";

          fisheyeCanvas = document.createElement("canvas");
          fisheyeCanvas.className = "video-fisheye-canvas";

          inner.appendChild(video);
          inner.appendChild(fisheyeCanvas);

          video.currentTime = lastVideoTime;
          video.play().catch(() => {});
        } else if (isVhs) {
          vhsCanvas = document.createElement("canvas");
          vhsCanvas.className = "vhs-canvas";
          inner.appendChild(vhsCanvas);
        } else if (isVinyl) {
          // The fluid-paint composition mounts its own (invisible, opacity:0)
          // canvas inside this wrapper -- see vinyl-reveal.js -- sitting on
          // top (z-index) of the visible vinylCanvas below so it intercepts
          // pointer events for both painting and orbiting.
          vinylFluidWrapper = document.createElement("div");
          vinylFluidWrapper.className = "vinyl-fluid-wrapper";
          inner.appendChild(vinylFluidWrapper);

          vinylCanvas = document.createElement("canvas");
          vinylCanvas.className = "vinyl-canvas";
          inner.appendChild(vinylCanvas);
        } else {
          img = document.createElement("img");
          img.draggable = false;
          img.decoding = "async";
          inner.appendChild(img);
        }

        inner.appendChild(caption);
        el.appendChild(inner);
        frag.appendChild(el);

        const tile = {
          el,
          img,
          caption,
          col: i,
          row: j,
          lastIndex: -1,
          isStack,
          stack3dEl: stack3d,
          back1El: back1,
          back2El: back2,
          isVideo,
          isVhs,
          isVinyl,
        };
        tiles.push(tile);
        if (isStack) {
          stackTile = tile;
          setStackImages(tile, stackIndex);
        }
        if (isVideo) {
          videoTile = tile;
          videoEl = video;
          fisheye = setupFisheye(fisheyeCanvas);
        }
        if (isVhs) {
          vhsTile = tile;
          vhsThree = setupVhs(vhsCanvas);
        }
        if (isVinyl) {
          vinylTile = tile;
          vinylReveal = createVinylReveal({
            canvas: vinylCanvas,
            fluidWrapperEl: vinylFluidWrapper,
            layer1Src: VINYL_LAYER1_SRC,
            layer2Src: VINYL_LAYER2_SRC,
            layer3Src: VINYL_LAYER3_SRC,
            modelUrl: VINYL_MODEL_SRC,
            tileWidth: TILE_W,
            tileHeight: TILE_H,
            isFocusedFn: () => isFocused && focusedTile === vinylTile,
          });
        }
      }
    }

    canvasEl.appendChild(frag);
    render(); // paint immediately so nothing flashes blank
  }

  // ---------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------

  function render() {
    const patternH = rows * CELL_H;

    for (const tile of tiles) {
      const baseX = offsetX + tile.col * CELL_W;
      const baseY = tile.row * CELL_H + tile.col * (CELL_H / cols);
      const rawY = baseY + pos.y;

      // Wrap each tile's vertical screen position into a seamless looping
      // band. Horizontal never moves, so baseX is used as-is, no wrapping.
      const wrappedY = mod(rawY, patternH) - CELL_H;

      tile.curX = baseX; // last on-screen position, used by enter/exitFocus
      tile.curY = wrappedY;
      tile.el.style.transform = `translate3d(${baseX.toFixed(1)}px, ${wrappedY.toFixed(1)}px, 0)`;

      // The stack tile ignores the normal wallpaper cycling below -- it
      // always shows the current STACK_IMAGES frame, advanced by clicks.
      if (tile.isStack) {
        if (tile.lastIndex !== stackIndex) setStackImages(tile, stackIndex);
        continue;
      }

      // The video tile ignores the cycling below too -- it just keeps
      // playing in place, drawn by the independent videoTick() loop.
      if (tile.isVideo) continue;

      // Same for item 1 vhs -- it just keeps spinning in place, drawn by
      // the independent vhsTick() loop.
      if (tile.isVhs) continue;

      // Same for item 4 vinyl -- it just keeps spinning in place, drawn by
      // the independent vinylTick() loop.
      if (tile.isVinyl) continue;

      // A tile's image must only change at the instant it wraps from one
      // edge of the buffer to the other (which happens off-screen). Using
      // floor(raw / patternSize) instead of rounding the continuous position
      // keeps the assigned image constant while the tile glides smoothly
      // across the visible viewport, and only swaps it at the (invisible)
      // wrap point -- otherwise the image flips every time the tile crosses
      // a cell boundary, which looks like it's teleporting mid-drag.
      const wrapCountY = Math.floor(rawY / patternH);
      const logicalRow = tile.row + wrapCountY * rows;
      const idx = imageIndexFor(tile.col, logicalRow);

      if (tile.lastIndex !== idx) {
        tile.img.src = IMAGES[idx];
        tile.img.alt = CAPTIONS[idx];
        tile.caption.textContent = CAPTIONS[idx];
        tile.lastIndex = idx;
      }
    }

    coordsEl.textContent = `Y ${Math.round(-pos.y)}`;
  }

  function tick() {
    // Freeze the wallpaper simulation entirely while a tile is focused, so
    // the focus/exit transforms set imperatively in enterFocus() aren't
    // immediately overwritten by the next frame's render().
    if (!isFocused) {
      if (!isDragging) {
        // Momentum: keep coasting the target, decaying velocity each frame.
        if (Math.abs(velocity.x) > MIN_VELOCITY || Math.abs(velocity.y) > MIN_VELOCITY) {
          target.x += velocity.x;
          target.y += velocity.y;
          velocity.x *= FRICTION;
          velocity.y *= FRICTION;
        } else {
          velocity.x = 0;
          velocity.y = 0;
        }
      }

      pos.x = lerp(pos.x, target.x, LERP_FACTOR);
      pos.y = lerp(pos.y, target.y, LERP_FACTOR);

      render();
    }

    requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------------
  // Focus mode -- click a tile to center + enlarge it, sending every other
  // tile off through whichever viewport edge it's already closest to.
  // ---------------------------------------------------------------------

  function enterFocus(tile) {
    if (isFocused) return;
    isFocused = true;
    focusedTile = tile;
    clearTimeout(unfocusTimer);

    // Kill any in-flight momentum/lerp so the wallpaper doesn't jump once
    // it un-freezes later.
    velocity.x = 0;
    velocity.y = 0;
    target.x = pos.x;
    target.y = pos.y;

    hintEl.classList.add("hidden");
    galleryEl.classList.add("focused");

    for (const t of tiles) {
      t.el.style.transition = `transform ${FOCUS_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`;

      if (t === tile) {
        t.el.style.zIndex = "20";
        const left = window.innerWidth / 2 - TILE_W / 2;
        const top = window.innerHeight / 2 - TILE_H / 2;
        t.el.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0) scale(${FOCUS_SCALE})`;

        // The stack tile rests flat (rotateY(0), see .stack-3d) so it reads
        // as a normal photo until it's focused -- kick it to the cascade's
        // base tilt here. Cursor-follow (applyStackTilt) takes over from
        // this angle on the next pointermove.
        if (t.isStack && t.stack3dEl) {
          t.stack3dEl.style.transform = `rotateY(${STACK_BASE_TILT}deg)`;
        }

        // Cursor-follow (updateFisheyeTarget) takes over on the next
        // pointermove; videoTick()'s lerp glides the bulge there from
        // center on its own, so no need to set it immediately here.
        continue;
      }

      // Distance from this tile's current center to each of the four
      // viewport edges -- it exits through whichever is closest, moving
      // along a single axis (purely vertical for top/bottom, purely
      // horizontal for left/right) rather than cutting a diagonal.
      const cx = t.curX + TILE_W / 2;
      const cy = t.curY + TILE_H / 2;
      const distTop = cy;
      const distBottom = window.innerHeight - cy;
      const distLeft = cx;
      const distRight = window.innerWidth - cx;
      const minDist = Math.min(distTop, distBottom, distLeft, distRight);

      let exitX = t.curX;
      let exitY = t.curY;
      if (minDist === distTop) {
        exitY = -TILE_H - FOCUS_EXIT_MARGIN;
      } else if (minDist === distBottom) {
        exitY = window.innerHeight + FOCUS_EXIT_MARGIN;
      } else if (minDist === distLeft) {
        exitX = -TILE_W - FOCUS_EXIT_MARGIN;
      } else {
        exitX = window.innerWidth + FOCUS_EXIT_MARGIN;
      }

      t.el.style.transform = `translate3d(${exitX.toFixed(1)}px, ${exitY.toFixed(1)}px, 0)`;
    }
  }

  function exitFocus() {
    if (!isFocused) return;
    isFocused = false;

    // Tilt-follow only runs while the stack is focused -- drop it back to
    // resting so it doesn't stay leaned wherever the cursor last was.
    if (focusedTile === stackTile) resetStackTilt();

    // Same idea for the fisheye bulge -- ease it back to center instead of
    // leaving it parked wherever the cursor last was.
    if (focusedTile === videoTile) {
      fisheyeTarget.x = 0.5;
      fisheyeTarget.y = 0.5;
    }

    // Same idea for item 1 vhs -- ease the lean back to resting (and let
    // the idle spin resume) instead of leaving it tilted wherever the
    // cursor last was.
    if (focusedTile === vhsTile) {
      vhsTiltTarget.x = 0;
      vhsTiltTarget.y = 0;
    }

    // Item 4 vinyl deliberately has no reset here -- vinylprocess itself
    // doesn't spring back on unfocus either; orbiting it leaves it exactly
    // where you left it, and painting is permanent (a latched reveal), so
    // there's nothing to ease back to.

    galleryEl.classList.remove("focused");
    if (focusedTile) focusedTile.el.style.zIndex = "";
    focusedTile = null;

    for (const t of tiles) {
      t.el.style.transform = `translate3d(${t.curX.toFixed(1)}px, ${t.curY.toFixed(1)}px, 0)`;
    }

    // Once the return transition finishes, drop the inline transition so
    // the per-frame render() loop resumes driving crisp, un-eased updates.
    clearTimeout(unfocusTimer);
    unfocusTimer = setTimeout(clearReturnTransition, FOCUS_TRANSITION_MS + 50);
  }

  // If new scroll/drag input arrives before the return transition above has
  // finished (and cleared itself), render()'s per-frame transform updates
  // would still be caught by that lingering CSS transition instead of
  // applying instantly -- every position update gets animated over 600ms,
  // which looks like the images are laggy/glitching. Called at the start of
  // any new gesture to cut the transition short as soon as fresh input needs
  // crisp, un-eased updates.
  function clearReturnTransition() {
    clearTimeout(unfocusTimer);
    unfocusTimer = null;
    for (const t of tiles) t.el.style.transition = "";
  }

  function handleClick(clientX, clientY) {
    const hit = document.elementFromPoint(clientX, clientY);
    const tileEl = hit && hit.closest(".tile");
    const tile = tileEl && tiles.find((t) => t.el === tileEl);

    if (isFocused) {
      if (tile === focusedTile) {
        // The stack tile shuffles to its next frame on every subsequent
        // click while focused, instead of the click doing nothing (normal
        // tiles) or exiting (handled by the tile !== focusedTile branch).
        if (tile.isStack) advanceStack();
      } else {
        exitFocus();
      }
    } else if (tile) {
      enterFocus(tile);
    }
  }

  // ---------------------------------------------------------------------
  // Photo stack -- clicking the designated stack tile slides its current
  // image away and glides the next STACK_IMAGES frame into place, looping
  // forever. Runs independently of focus mode.
  // ---------------------------------------------------------------------

  // Front card shows the current frame; the two cards behind it preview the
  // frames coming up next, so what peeks out from the stack is always a real
  // upcoming photo rather than a blank filler.
  function setStackImages(tile, index) {
    const n = STACK_IMAGES.length;
    tile.img.src = STACK_IMAGES[index];
    tile.img.alt = `Stack frame ${index + 1}`;
    if (tile.back1El) tile.back1El.style.backgroundImage = `url("${STACK_IMAGES[(index + 1) % n]}")`;
    if (tile.back2El) tile.back2El.style.backgroundImage = `url("${STACK_IMAGES[(index + 2) % n]}")`;
    tile.lastIndex = index;
  }

  function advanceStack() {
    if (stackAnimating || !stackTile) return;
    stackAnimating = true;

    const tile = stackTile;
    const img = tile.img;

    // The real front element immediately becomes the NEXT frame and
    // animates in; a cloned "ghost" holding the OLD frame plays the exit
    // animation alongside it. Two different images, two elements, moving in
    // the same transition window -- rather than one waiting for the other
    // to finish before it can start.
    const ghost = img.cloneNode(true);
    ghost.classList.add("stack-exit");
    img.before(ghost);

    stackIndex = (stackIndex + 1) % STACK_IMAGES.length;
    setStackImages(tile, stackIndex);

    img.classList.add("stack-enter");

    // Double rAF: let the browser paint the "enter" starting pose (no
    // transition, set below in CSS) on one frame, then remove the class
    // on the next so it transitions from that pose back to neutral --
    // removing it in the same frame it was added could get coalesced and
    // skip the animation entirely.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        img.classList.remove("stack-enter");
      });
    });

    stackShuffleTimer = setTimeout(() => {
      ghost.remove();
      stackAnimating = false;
    }, STACK_TRANSITION_MS);
  }

  // ---------------------------------------------------------------------
  // Stack tilt-follow -- while the stack tile is focused, the cursor's
  // position anywhere in the viewport (not just over the tile itself) leans
  // its 3D rotation toward it, on both axes, like tilting a real photo stack
  // in your hand. Each axis is clamped to STACK_TILT_RANGE either side of
  // its resting angle, so it's always a subtle lean, never a full spin.
  // ---------------------------------------------------------------------

  function applyStackTilt(clientX, clientY) {
    if (!stackTile || !stackTile.stack3dEl) return;
    const rect = stackTile.el.getBoundingClientRect();
    const normalizedX = clamp((clientX - (rect.left + rect.width / 2)) / (rect.width / 2), -1, 1);
    const normalizedY = clamp((clientY - (rect.top + rect.height / 2)) / (rect.height / 2), -1, 1);
    const angleY = STACK_BASE_TILT + normalizedX * STACK_TILT_RANGE;
    const angleX = -normalizedY * STACK_TILT_RANGE;
    stackTile.stack3dEl.style.transform = `rotateX(${angleX.toFixed(2)}deg) rotateY(${angleY.toFixed(2)}deg)`;
  }

  function resetStackTilt() {
    if (!stackTile || !stackTile.stack3dEl) return;
    stackTile.stack3dEl.style.transform = "";
  }

  // ---------------------------------------------------------------------
  // Fisheye video -- the video tile is always rendered through a WebGL
  // barrel/bulge distortion (see the fragment shader in setupFisheye()).
  // The bulge rests centered and, while the tile is focused, glides to
  // follow the cursor across the whole viewport, mirroring the stack's
  // tilt-follow above.
  // ---------------------------------------------------------------------

  function setupFisheye(canvas) {
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return null; // video still plays underneath, just without the distortion

    const vertexSrc = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() {
        // v_uv: 0..1 with y=0 at the top, matching clientY/CSS conventions
        // used everywhere else the cursor position feeds into a tile.
        v_uv = vec2(a_pos.x * 0.5 + 0.5, 1.0 - (a_pos.y * 0.5 + 0.5));
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    const fragmentSrc = `
      precision mediump float;
      varying vec2 v_uv;
      uniform sampler2D u_tex;
      uniform vec2 u_center;
      uniform float u_aspect;
      uniform float u_power;
      uniform float u_radius;
      uniform vec2 u_coverScale;
      uniform vec2 u_coverOffset;

      void main() {
        // Backward-map each screen pixel to a source radius scaled by
        // pow(rn, power): power > 1 pulls the sample point closer to
        // u_center as rn grows, so texture content near the center gets
        // spread over a wider screen area (a magnifying bulge) while the
        // edge (rn == u_radius, texR == u_radius) stays a fixed point.
        // Fills the whole tile -- no circular mask/vignette.
        vec2 d = v_uv - u_center;
        d.x *= u_aspect;
        float r = length(d);
        float rn = min(r / u_radius, 1.4);
        vec2 dir = r > 0.0001 ? d / r : vec2(0.0);
        float texR = u_radius * pow(rn, u_power);
        vec2 warpedD = dir * texR;
        vec2 warped = u_center + vec2(warpedD.x / u_aspect, warpedD.y);

        if (warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0) {
          gl_FragColor = vec4(0.02, 0.02, 0.02, 1.0);
          return;
        }

        // Map tile-space (post-warp) into the video's own UV rect so the
        // source crops like CSS object-fit: cover instead of stretching.
        // v_uv is already y-flipped to CSS-style (y=0 at top) up in the
        // vertex shader -- that flip alone is what lands the video right
        // way up (verified against a 2D-canvas drawImage() reference,
        // which browsers always orient correctly). Flipping again here, or
        // adding UNPACK_FLIP_Y_WEBGL below, cancels it back to upside down,
        // so this must stay a plain, unflipped sample.
        vec2 sampleUV = u_coverOffset + warped * u_coverScale;
        gl_FragColor = texture2D(u_tex, sampleUV);
      }
    `;

    function compile(type, src) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vs = compile(gl.VERTEX_SHADER, vertexSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragmentSrc);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return null;
    }
    gl.useProgram(program);

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    return {
      gl,
      texture,
      uniforms: {
        center: gl.getUniformLocation(program, "u_center"),
        aspect: gl.getUniformLocation(program, "u_aspect"),
        power: gl.getUniformLocation(program, "u_power"),
        radius: gl.getUniformLocation(program, "u_radius"),
        coverScale: gl.getUniformLocation(program, "u_coverScale"),
        coverOffset: gl.getUniformLocation(program, "u_coverOffset"),
      },
    };
  }

  function drawFisheyeFrame() {
    if (!fisheye || !videoEl || videoEl.readyState < 2) return;
    const { gl, uniforms, texture } = fisheye;
    const canvas = gl.canvas;

    // Match the backing-store resolution to the tile's on-screen size so
    // the video isn't upscaled blurrily inside a stale (e.g. 300x150) buffer.
    if (canvas.width !== TILE_W || canvas.height !== TILE_H) {
      canvas.width = TILE_W;
      canvas.height = TILE_H;
      gl.viewport(0, 0, TILE_W, TILE_H);
    }

    // No UNPACK_FLIP_Y_WEBGL here -- the vertex shader's own y-flip (see
    // setupFisheye()) is already the one deliberate flip that lands the
    // video right way up; adding this too would cancel it back out.
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoEl);

    const vw = videoEl.videoWidth || 16;
    const vh = videoEl.videoHeight || 9;
    const containerAspect = TILE_W / TILE_H;
    const srcAspect = vw / vh;
    let coverScaleX = 1;
    let coverScaleY = 1;
    let coverOffX = 0;
    let coverOffY = 0;
    if (srcAspect > containerAspect) {
      coverScaleX = containerAspect / srcAspect;
      coverOffX = (1 - coverScaleX) / 2;
    } else {
      coverScaleY = srcAspect / containerAspect;
      coverOffY = (1 - coverScaleY) / 2;
    }

    gl.uniform2f(uniforms.center, fisheyeCenter.x, fisheyeCenter.y);
    gl.uniform1f(uniforms.aspect, containerAspect);
    gl.uniform1f(uniforms.power, FISHEYE_POWER);
    gl.uniform1f(uniforms.radius, FISHEYE_RADIUS);
    gl.uniform2f(uniforms.coverScale, coverScaleX, coverScaleY);
    gl.uniform2f(uniforms.coverOffset, coverOffX, coverOffY);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Cursor tracking, only while the video tile is the focused one -- same
  // viewport-wide listener pattern as applyStackTilt.
  function updateFisheyeTarget(clientX, clientY) {
    if (!videoTile) return;
    const rect = videoTile.el.getBoundingClientRect();
    fisheyeTarget.x = clamp((clientX - rect.left) / rect.width, 0, 1);
    fisheyeTarget.y = clamp((clientY - rect.top) / rect.height, 0, 1);
  }

  // Runs continuously (not gated by isFocused/tick's freeze) so the video
  // keeps playing and the bulge keeps easing even while the wallpaper
  // simulation is frozen for focus mode.
  function videoTick() {
    if (videoTile && fisheye) {
      fisheyeCenter.x = lerp(fisheyeCenter.x, fisheyeTarget.x, FISHEYE_CENTER_LERP);
      fisheyeCenter.y = lerp(fisheyeCenter.y, fisheyeTarget.y, FISHEYE_CENTER_LERP);
      drawFisheyeFrame();
    }
    requestAnimationFrame(videoTick);
  }

  // ---------------------------------------------------------------------
  // Item 1 vhs -- a real 3D model (GLB) rendered in its own Three.js scene,
  // one per pinned tile instance, same one-fixed-slot trick as the stack
  // and fisheye video above. Idles with a slow constant spin; once focused,
  // the spin freezes and the cursor leans it instead (same interaction
  // language as the stack's tilt-follow).
  // ---------------------------------------------------------------------

  function setupVhs(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0); // fully transparent -- the tile shows the red CMS backdrop through it, not a fill color
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, TILE_W / TILE_H, 0.01, 10);
    // Straight-on, label-facing-camera shot (per reference screenshot: SONY
    // top, T-120 bottom, notch on the right) -- not the 3/4 angle the vhs/
    // project's own turntable viewer uses. Found empirically: the label sits
    // on the model's +Y face (the thin axis -- the tape lies flat, label up),
    // and camera.up must be +Z or the top-down view reads sideways/upside
    // down (lookAt can't infer roll from a pure vertical view direction).
    const viewDir = new THREE.Vector3(0, 1, 0);
    camera.up.set(0, 0, 1);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(0.3, 1, 0.6);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x9fb8ff, 0.6);
    fillLight.position.set(-0.3, 0.6, -0.6);
    scene.add(fillLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // The loaded model gets centered and scaled into this group, so
    // tilting/spinning the group never has to fight the model's own
    // off-center pivot or unknown source scale.
    const group = new THREE.Group();
    scene.add(group);

    new GLTFLoader().load(VHS_MODEL_SRC, (gltf) => {
      const model = gltf.scene;

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      model.scale.setScalar(VHS_TARGET_SIZE / maxDim);

      const box2 = new THREE.Box3().setFromObject(model);
      const center2 = box2.getCenter(new THREE.Vector3());
      model.position.sub(center2);

      group.add(model);

      // Frame the camera off the model's own bounding sphere (rotation-
      // invariant, so the idle spin and cursor tilt never swing a corner
      // past the frustum) instead of the fixed distance ported from the
      // vhs/ project's square-ish window -- that distance only happened to
      // clear the model there; a narrower/wider tile aspect here needs its
      // own math or it crops.
      const sphere = box2.getBoundingSphere(new THREE.Sphere());
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      // Whichever axis is tighter (portrait tiles: horizontal) sets the
      // required distance -- fitting only the looser axis would crop the
      // other.
      const distV = sphere.radius / Math.sin(vFov / 2);
      const distH = sphere.radius / Math.sin(hFov / 2);
      const distance = Math.max(distV, distH) * 1.15; // 15% padding so the model doesn't touch the tile edges

      camera.position.copy(viewDir).multiplyScalar(distance);
      camera.near = distance / 100;
      camera.far = distance * 10;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0, 0);
    });

    renderer.setSize(TILE_W, TILE_H, false);

    return { renderer, scene, camera, group };
  }

  function applyVhsTilt(clientX, clientY) {
    if (!vhsTile) return;
    const rect = vhsTile.el.getBoundingClientRect();
    const normalizedX = clamp((clientX - (rect.left + rect.width / 2)) / (rect.width / 2), -1, 1);
    const normalizedY = clamp((clientY - (rect.top + rect.height / 2)) / (rect.height / 2), -1, 1);
    vhsTiltTarget.y = normalizedX * VHS_TILT_RANGE;
    vhsTiltTarget.x = normalizedY * VHS_TILT_RANGE;
  }

  // Runs continuously (not gated by isFocused/tick's freeze) so a lingering
  // return-to-resting ease still finishes even while the wallpaper
  // simulation is frozen for focus mode on some other tile.
  function vhsTick() {
    if (vhsTile && vhsThree) {
      const { renderer, scene, camera, group } = vhsThree;

      // Same resting-vs-3D-mode split as the stack: flat/facing-camera
      // (rotation target (0,0)) until focused, cursor-driven tilt (item 1
      // vhs's "3D mode") only once selected -- see applyVhsTilt() and
      // exitFocus()'s vhsTiltTarget reset above.
      const target = isFocused && focusedTile === vhsTile ? vhsTiltTarget : { x: 0, y: 0 };
      vhsTiltCurrent.x = lerp(vhsTiltCurrent.x, target.x, VHS_TILT_LERP);
      vhsTiltCurrent.y = lerp(vhsTiltCurrent.y, target.y, VHS_TILT_LERP);
      group.rotation.x = vhsTiltCurrent.x;
      group.rotation.y = vhsTiltCurrent.y;

      // Match the backing-store resolution to the tile's on-screen size,
      // same reasoning as the fisheye canvas above.
      const canvas = renderer.domElement;
      if (canvas.width !== TILE_W || canvas.height !== TILE_H) {
        renderer.setSize(TILE_W, TILE_H, false);
        camera.aspect = TILE_W / TILE_H;
        camera.updateProjectionMatrix();
      }

      renderer.render(scene, camera);
    }
    requestAnimationFrame(vhsTick);
  }

  // ---------------------------------------------------------------------
  // Item 4 vinyl -- setup lives in vinyl-reveal.js (createVinylReveal()),
  // ported directly off vinylprocess's <HoverRevealShader>: same two-mask
  // paint-to-reveal, same stroke-snapshot gate, same manual orbit. This
  // tick just delegates to the handle's own update function each frame.
  // ---------------------------------------------------------------------

  function vinylTick() {
    if (vinylReveal) vinylReveal.tick();
    requestAnimationFrame(vinylTick);
  }

  // ---------------------------------------------------------------------
  // Pointer (mouse + touch) drag input
  // ---------------------------------------------------------------------

  function onPointerDown(e) {
    // While vinyl is the focused tile, its own listeners (the fluid
    // paint canvas + createManualOrbit) need completely normal, uncaptured
    // pointer events -- the same conflict vinylprocess's own useManualOrbit
    // comment warns about with drei's OrbitControls. Capturing the pointer
    // here (below) redirects every subsequent pointermove/up to galleryEl
    // regardless of where the cursor actually is, which silently breaks
    // both painting and orbiting. On top of that, hasMoved only tracks
    // vertical movement (the wallpaper only scrolls vertically), so a
    // horizontal-only paint stroke reads as "no movement" -- if it happens
    // to end outside the tile's bounds, handleClick() then sees
    // `tile !== focusedTile` and spuriously calls exitFocus(), shrinking
    // the tile back to unfocused scale mid-paint. Bypassing this handler
    // entirely for gestures starting on the focused vinyl tile avoids
    // both problems at once; a later click actually outside the tile is
    // a separate gesture and still exits focus normally.
    if (isFocused && focusedTile === vinylTile && e.target.closest(".tile.vinyl")) {
      return;
    }

    isDragging = true;
    hasMoved = false;
    pointerId = e.pointerId;
    galleryEl.classList.add("dragging");
    galleryEl.setPointerCapture(pointerId);

    if (unfocusTimer !== null) clearReturnTransition();

    startPointer = { x: e.clientX, y: e.clientY };
    startTarget = { x: target.x, y: target.y };
    lastPointer = { x: e.clientX, y: e.clientY, t: performance.now() };
    velocity.x = 0;
    velocity.y = 0;
  }

  function onPointerMove(e) {
    if (!isDragging || e.pointerId !== pointerId) return;

    const dy = e.clientY - startPointer.y;
    if (Math.abs(dy) > 2) {
      hasMoved = true;
      hintEl.classList.add("hidden");
    }

    // Dragging no longer closes focus mode -- only a click outside the
    // focused tile does (handleClick). The wallpaper simulation is frozen
    // while focused anyway, so there's nothing here to scroll.
    if (isFocused) return;

    // Vertical only -- target.x never moves.
    target.y = startTarget.y + dy;

    const now = performance.now();
    const dt = Math.max(now - lastPointer.t, 1);
    // Instantaneous velocity, normalized to a ~60fps frame step.
    velocity.y = clamp(((e.clientY - lastPointer.y) / dt) * 16, -MAX_VELOCITY, MAX_VELOCITY);
    lastPointer = { x: e.clientX, y: e.clientY, t: now };
  }

  function onPointerUp(e) {
    if (e.pointerId !== pointerId) return;
    const wasClick = !hasMoved;
    isDragging = false;
    galleryEl.classList.remove("dragging");
    galleryEl.releasePointerCapture(pointerId);
    pointerId = null;
    // velocity already holds the last measured swipe speed -> momentum carries on in tick()

    if (wasClick) handleClick(e.clientX, e.clientY);
  }

  function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
  }

  // ---------------------------------------------------------------------
  // Wheel / trackpad input
  // ---------------------------------------------------------------------

  function onWheel(e) {
    e.preventDefault();

    // Scrolling no longer closes focus mode -- only a click outside the
    // focused tile does (handleClick). The wallpaper simulation is frozen
    // while focused anyway, so there's nothing here to scroll.
    if (isFocused) return;

    if (unfocusTimer !== null) clearReturnTransition();

    hintEl.classList.add("hidden");

    // Vertical only -- horizontal wheel/trackpad delta is ignored.
    target.y -= e.deltaY * WHEEL_MULTIPLIER;

    // Nudge velocity too, so a hard wheel flick still carries a touch of momentum.
    velocity.y = clamp(-e.deltaY * 0.5, -MAX_VELOCITY, MAX_VELOCITY);
  }

  // ---------------------------------------------------------------------
  // Wire up
  // ---------------------------------------------------------------------

  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // buildGrid() tears down and recreates every tile, so any in-progress
      // focus state (and its DOM references) would otherwise go stale and
      // leave rendering frozen.
      isFocused = false;
      focusedTile = null;
      galleryEl.classList.remove("focused");

      // buildGrid() below tears down and recreates the stack tile's DOM, so
      // an in-flight shuffle timer would otherwise fire later against a
      // detached <img> and leave stackAnimating stuck true, permanently
      // blocking clicks on the new stack tile.
      clearTimeout(stackShuffleTimer);
      stackAnimating = false;

      // buildGrid() also tears down and recreates the video tile's <video>,
      // which would otherwise restart the clip from 0:00 on every resize.
      if (videoEl) lastVideoTime = videoEl.currentTime || 0;

      buildGrid();
    }, 150);
  }

  function preloadImages() {
    // The wallpaper only ever cycles through this fixed, small set, so
    // warming the browser cache up front means a tile wrapping to a "new"
    // image never has to wait on a network fetch and flash blank.
    for (const src of [...IMAGES, ...STACK_IMAGES]) {
      const img = new Image();
      img.src = src;
    }
  }

  galleryEl.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  galleryEl.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("resize", onResize);

  // Tilt-follow only runs while the stack is the focused tile, but then
  // tracks the cursor across the whole viewport, not just while over the
  // tile itself -- this single listener covers hover AND drag, since pointer
  // capture during a drag still bubbles pointermove up to window even though
  // it retargets the event to galleryEl.
  window.addEventListener("pointermove", (e) => {
    if (isFocused && focusedTile === stackTile) applyStackTilt(e.clientX, e.clientY);
    if (isFocused && focusedTile === videoTile) updateFisheyeTarget(e.clientX, e.clientY);
    if (isFocused && focusedTile === vhsTile) applyVhsTilt(e.clientX, e.clientY);
    // Item 4 vinyl's orbit tracks the cursor via its own window pointermove
    // listener (see createManualOrbit() in vinyl-reveal.js), gated by its
    // own isFocusedFn -- nothing needed here.
  });

  preloadImages();
  buildGrid();
  requestAnimationFrame(tick);
  requestAnimationFrame(videoTick);
  requestAnimationFrame(vhsTick);
  requestAnimationFrame(vinylTick);
})();
