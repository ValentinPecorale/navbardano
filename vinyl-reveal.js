// Vanilla-JS port of vinylprocess's src/components/hover-reveal-shader.tsx --
// same paint-to-reveal mask math, same stroke-snapshot gating, same manual
// orbit, ported off React Three Fiber (useFrame/useThree/<Canvas>) onto a
// plain setup()+tick() pair matching this gallery's own vhs/fisheye tiles.
// The one piece that couldn't be de-Reacted is `ShaderLabComposition`
// itself (the fluid-paint simulation) -- it's a packaged React component
// (peer-deps react@19/react-dom@19, no react-three-fiber), so it's mounted
// into its own tiny, isolated React root via react-dom/client, exactly the
// way it already runs in vinylprocess -- everything downstream of its
// canvas (the mask math, the vinyl geometry, the orbit) is plain JS.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  dot,
  float,
  max as tslMax,
  min as tslMin,
  mix,
  positionLocal,
  smoothstep,
  texture as tslTexture,
  uv,
  vec2,
  vec3,
  vec4,
  viewportUV,
} from "three/tsl";
import { MeshBasicNodeMaterial, WebGPURenderer } from "three/webgpu";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { ShaderLabComposition } from "@basementstudio/shader-lab";

const ACCUM_SIZE = 512;
const ACCUM_RT_OPTIONS = {
  depthBuffer: false,
  generateMipmaps: false,
  magFilter: THREE.NearestFilter,
  minFilter: THREE.NearestFilter,
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
};
const LUMINANCE_WEIGHTS = vec3(0.2126, 0.7152, 0.0722);
// WebGLRenderTarget/RenderTarget textures come out vertically flipped
// relative to normal image/canvas textures in this renderer, so re-sampling
// one in a later pass needs this correction (canvas/image textures do not).
const renderTargetUv = vec2(uv().x, float(1).sub(uv().y));
// Screen-space viewport UV instead of the consuming mesh's own UV -- for
// painting onto a 3D model's surface where mesh UV doesn't correspond to
// screen position.
const viewportMaskUv = viewportUV;
// The fluid composition's own WebGPU context can take a while to spin up
// (it's a second, independent WebGPU context on the page). Until it has,
// its canvas can read back as blank/garbage rather than true black -- and
// since the mask latches forever, sampling it too early would permanently
// bake in a false "fully revealed" state. So instead of guessing a fixed
// delay, actually sample the canvas each frame and only start accumulating
// once it reads back sane (near-black), with a generous timeout fallback.
const WARMUP_MIN_MS = 500;
const WARMUP_TIMEOUT_MS = 30000;
const WARMUP_BRIGHTNESS_THRESHOLD = 40; // out of 255
// Reveal threshold: how strongly an area must be painted (raw latch value)
// before it snaps to fully showing the next layer.
const REVEAL_LOW = 0.35;
const REVEAL_HIGH = 0.55;
// Both masks use the exact same additive-creep mechanism at the exact same
// rate -- once triggered, either reveal takes the same amount of dragging.
// It's the stroke-snapshot gate alone (see createStrokeSnapshotTexture),
// not a speed difference, that makes the second reveal a deliberate
// separate act.
const CREEP_GAIN = 0.02;
// Painting stays locked for this long after the tile is first focused --
// gives the click-to-focus zoom transition room to finish and settle
// before a drag can register as paint, rather than the very click that
// focuses the tile potentially reading as a stroke's first sample.
const REVEAL_UNLOCK_DELAY_MS = 500;

const RECORD_SURFACE_MATERIAL_NAME = "tracks";
const RECORD_LABEL_MATERIAL_NAME = "label";
// The label mesh's own UV coordinates are degenerate in this model (a
// single point), so its texture is mapped from local position instead.
const LABEL_LOCAL_RADIUS = 0.0507;
const LABEL_IMAGE_RADIUS = 0.15;
const ROTATE_SPEED = 0.006;
const ROTATE_PITCH_LIMIT = Math.PI / 3;

// Fluid layer only -- its live canvas is sampled as a luminance mask, never
// rendered on screen itself (opacity 0, but still receives real pointer
// events since it sits on top of the visible vinyl canvas).
const fluidMaskConfig = {
  layers: [
    {
      blendMode: "normal",
      compositeMode: "filter",
      maskConfig: { invert: false, mode: "multiply", source: "luminance" },
      hue: 0,
      id: "fluid-mask",
      kind: "source",
      name: "Fluid Mask",
      opacity: 1,
      params: {
        simRes: 64,
        dyeRes: 512,
        iterations: 20,
        densityDissipation: 4.2,
        velocityDissipation: 18,
        pressureDissipation: 0,
        curlStrength: 1.5,
        radius: 0.75,
        splatForce: 6000,
        autoSplats: false,
        brightness: 2.2,
        colorMode: "monochrome",
        monoDark: "#000000",
        monoLight: "#ffffff",
        duotoneDark: "#101010",
        duotoneLight: "#f3f3ef",
      },
      saturation: 1,
      type: "fluid",
      visible: true,
    },
  ],
  timeline: { duration: 8, loop: true, tracks: [] },
};

function isCanvasSettled(canvas, probeCtx) {
  try {
    probeCtx.drawImage(canvas, 0, 0, 8, 8);
    const { data } = probeCtx.getImageData(0, 0, 8, 8);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += data[i] + data[i + 1] + data[i + 2];
    }
    return sum / ((data.length / 4) * 3) < WARMUP_BRIGHTNESS_THRESHOLD;
  } catch {
    return false;
  }
}

// Renders `max(previousLatchedMask, currentFluidMask)` into a ping-ponged
// render target every frame, so once an area is revealed by the fluid it
// never fades back -- only the union of everywhere it has ever painted.
// With `creepGain`, this instead creeps up additively every frame the live
// fluid is bright here (capped at 1) -- what makes "paint more to reveal
// more" possible.
function createLatchedMask(gl, fluidCanvas, options = {}) {
  const rtA = new THREE.WebGLRenderTarget(ACCUM_SIZE, ACCUM_SIZE, ACCUM_RT_OPTIONS);
  const rtB = new THREE.WebGLRenderTarget(ACCUM_SIZE, ACCUM_SIZE, ACCUM_RT_OPTIONS);

  const fluidTexture = new THREE.CanvasTexture(fluidCanvas);
  const fluidNode = tslTexture(fluidTexture, uv());
  const prevNode = tslTexture(rtA.texture, renderTargetUv);
  const fluidLuminance = dot(fluidNode.rgb, LUMINANCE_WEIGHTS);
  const prevLuminance = dot(prevNode.rgb, LUMINANCE_WEIGHTS);
  // Backed by this mask's own still-cleared rtA until the gate ref hands
  // over a real frame -- reads as "not revealed yet", the correct default.
  const gateNode = options.gateRef ? tslTexture(rtA.texture, renderTargetUv) : null;
  const gate = gateNode
    ? smoothstep(REVEAL_LOW, REVEAL_HIGH, dot(gateNode.rgb, LUMINANCE_WEIGHTS))
    : null;
  const gatedFluidLuminance = gate ? fluidLuminance.mul(gate) : fluidLuminance;
  const latched = options.creepGain
    ? tslMin(prevLuminance.add(gatedFluidLuminance.mul(options.creepGain)), float(1))
    : tslMax(prevLuminance, fluidLuminance);

  const mat = new MeshBasicNodeMaterial();
  mat.colorNode = vec4(vec3(latched), 1);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const outputNode = tslTexture(rtB.texture, options.outputUv ?? renderTargetUv);

  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = 8;
  probeCanvas.height = 8;
  const probeCtx = probeCanvas.getContext("2d", { willReadFrequently: true });

  gl.setRenderTarget(rtA);
  gl.clear();
  gl.setRenderTarget(rtB);
  gl.clear();
  gl.setRenderTarget(null);

  const latchRef = { current: null };
  const state = {
    read: rtA,
    write: rtB,
    scene,
    camera,
    fluidTexture,
    prevNode,
    outputNode,
    gateNode,
    fluidCanvas,
    probeCtx,
    startedAt: Date.now(),
    armed: false,
  };
  let ready = true;

  function update() {
    if (!ready) return;
    state.fluidTexture.needsUpdate = true;

    if (!state.armed) {
      const elapsed = Date.now() - state.startedAt;
      const settled = elapsed >= WARMUP_MIN_MS && isCanvasSettled(state.fluidCanvas, state.probeCtx);
      const timedOut = elapsed >= WARMUP_TIMEOUT_MS;
      if (settled || timedOut) {
        state.armed = true;
      } else {
        gl.setRenderTarget(state.read);
        gl.clear();
        gl.setRenderTarget(state.write);
        gl.clear();
        gl.setRenderTarget(null);
        state.outputNode.value = state.write.texture;
        return;
      }
    }

    state.prevNode.value = state.read.texture;
    if (state.gateNode && options.gateRef && options.gateRef.current) {
      state.gateNode.value = options.gateRef.current;
    }

    gl.setRenderTarget(state.write);
    gl.render(state.scene, state.camera);
    gl.setRenderTarget(null);

    state.outputNode.value = state.write.texture;
    latchRef.current = state.write.texture;

    const nextRead = state.write;
    const nextWrite = state.read;
    state.read = nextRead;
    state.write = nextWrite;
  }

  function dispose() {
    ready = false;
    rtA.dispose();
    rtB.dispose();
    fluidTexture.dispose();
    mat.dispose();
    mesh.geometry.dispose();
  }

  // Clears both accumulation buffers back to black (0 = nothing revealed)
  // and re-arms the warmup probe, so the next paint stroke starts from a
  // genuinely blank latch rather than carrying over whatever was painted
  // last time this tile was focused.
  function reset() {
    if (!ready) return;
    gl.setRenderTarget(rtA);
    gl.clear();
    gl.setRenderTarget(rtB);
    gl.clear();
    gl.setRenderTarget(null);
    state.armed = false;
    state.startedAt = Date.now();
    latchRef.current = null;
  }

  return {
    latchRef,
    get node() {
      return ready ? outputNode : null;
    },
    update,
    reset,
    dispose,
  };
}

// Renders a true, static, point-in-time GPU copy of `sourceRef`'s current
// texture into its own dedicated render target, only at the start of each
// new left-click stroke (pointerdown) -- unlike a plain JS reference to
// `sourceRef.current`, this copy's destination buffer is owned solely by
// this instance and nothing else ever writes into it between pointerdowns,
// so it genuinely stays frozen.
function createStrokeSnapshotTexture(gl, domElement, sourceRef, isEnabledFn) {
  const rt = new THREE.WebGLRenderTarget(ACCUM_SIZE, ACCUM_SIZE, ACCUM_RT_OPTIONS);

  // Reads as "nothing revealed" until the first real pointerdown copy.
  const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blackTex.needsUpdate = true;

  const sourceNode = tslTexture(blackTex, renderTargetUv);
  const mat = new MeshBasicNodeMaterial();
  mat.colorNode = vec4(sourceNode.rgb, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  gl.setRenderTarget(rt);
  gl.clear();
  gl.setRenderTarget(null);

  const snapshotRef = { current: rt.texture };
  let pending = false;

  const onPointerDown = (e) => {
    // Touch is driven exclusively by the touch-gesture controller's
    // onPaintStart callback (markPending below) -- a second finger landing
    // also satisfies button===0 and would otherwise re-mark a stroke as
    // pending mid-rotate.
    if (e.pointerType === "touch") return;
    if (e.button !== 0 || !isEnabledFn()) return;
    pending = true;
  };
  domElement.addEventListener("pointerdown", onPointerDown);

  function markPending() {
    pending = true;
  }

  function update() {
    if (!pending) return;
    if (!sourceRef.current) return; // mask1 hasn't produced a frame yet; retry
    pending = false;
    sourceNode.value = sourceRef.current;
    gl.setRenderTarget(rt);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
  }

  function dispose() {
    domElement.removeEventListener("pointerdown", onPointerDown);
    rt.dispose();
    mat.dispose();
    mesh.geometry.dispose();
    blackTex.dispose();
  }

  // Clears the snapshot back to black (nothing revealed) and drops any
  // still-pending copy from the stroke that was in progress.
  function reset() {
    gl.setRenderTarget(rt);
    gl.clear();
    gl.setRenderTarget(null);
    pending = false;
  }

  return { snapshotRef, update, reset, dispose };
}

// Right-drag to rotate the model, gated by `isEnabledFn` -- only active
// while this gallery tile is the focused one (same convention as the vhs
// tile's cursor-tilt). Unclamped on the spin (y) axis, clamped on pitch
// (x), matching vinylprocess's own useManualOrbit exactly.
//
// `applyDelta` is exposed separately so the touch-gesture controller can
// drive the same rotation math from a two-finger touch drag, which has no
// mouse button to gate on.
function createManualOrbit(domElement, group, isEnabledFn) {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function applyDelta(dx, dy) {
    if (!group) return;
    group.rotation.y += dx * ROTATE_SPEED;
    group.rotation.x = THREE.MathUtils.clamp(
      group.rotation.x + dy * ROTATE_SPEED,
      -ROTATE_PITCH_LIMIT,
      ROTATE_PITCH_LIMIT
    );
  }

  const onPointerDown = (e) => {
    if (e.button !== 2 || !isEnabledFn()) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    applyDelta(dx, dy);
  };
  const onPointerUp = () => {
    dragging = false;
  };
  const onContextMenu = (e) => {
    if (isEnabledFn()) e.preventDefault();
  };

  domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  domElement.addEventListener("contextmenu", onContextMenu);

  function dispose() {
    domElement.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    domElement.removeEventListener("contextmenu", onContextMenu);
  }

  return { dispose, applyDelta };
}

// Touch-only gesture controller: one finger paints (locking scroll via
// CSS touch-action on the gallery/tile), a second finger switches to
// rotate. Mouse/pen are untouched -- they keep using button-gated
// listeners in createManualOrbit/createStrokeSnapshotTexture above.
//
// Two listener scopes, same split as createManualOrbit's mouse path:
//  - `wrapperEl`, capture phase: decides whether an event may reach the
//    fluid-paint canvas at all (must run before FluidPass's own listener).
//  - `window`: tracks finger positions/deltas so a finger that drags
//    outside the tile's bounds is still tracked, matching mouse behavior.
function createTouchGestureController(wrapperEl, canvasEl, isEnabledFn, { onPaintStart, onRotateMove }) {
  const touches = new Map(); // pointerId -> {x, y}
  let mode = "idle"; // 'idle' | 'paint' | 'rotate'
  let primaryId = null;

  function onWrapperPointerDownCapture(event) {
    // Mouse pointerdown was never gated here before (only pointermove was,
    // via the old blockHoverPaint) -- leave that behavior exactly as-is.
    if (event.pointerType !== "touch") return;
    // Not focused: don't track or block anything, so an unfocused tile's
    // normal touch-drag-to-scroll-the-gallery behavior is untouched (same
    // rationale as createManualOrbit/createStrokeSnapshotTexture gating
    // drag-start on isEnabledFn() rather than gating every move).
    if (!isEnabledFn()) return;
    const wasEmpty = touches.size === 0;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (wasEmpty) {
      primaryId = event.pointerId;
      mode = "paint";
      onPaintStart();
      // First finger's own touchdown is a legitimate first stroke sample --
      // let it through.
      return;
    }
    if (touches.size === 2) {
      mode = "rotate";
    }
    // Any touchdown beyond the first (the 2nd finger landing, or a stray
    // 3rd+) must never reach the fluid canvas as a paint sample.
    event.stopPropagation();
  }

  function onWrapperPointerMoveCapture(event) {
    if (event.pointerType !== "touch") {
      if (event.buttons === 0 || !isEnabledFn()) event.stopPropagation();
      return;
    }
    if (mode === "rotate" || !isEnabledFn()) event.stopPropagation();
  }

  function endTouch(pointerId) {
    if (!touches.has(pointerId)) return;
    const wasRotating = mode === "rotate";
    touches.delete(pointerId);

    if (touches.size === 0) {
      mode = "idle";
      primaryId = null;
      return;
    }

    if (wasRotating) {
      // Dropping back to one finger: resume painting immediately with the
      // remaining finger. FluidPass tracks a single shared
      // lastPointerX/lastPointerY, reset to null only on `pointerleave` --
      // since every touch event was blocked from it during rotate, that
      // state is stale (last real value came from the primary finger,
      // before the 2nd finger landed). A synthetic pointerleave nulls it,
      // so the remaining finger's next real pointermove just re-anchors
      // position instead of diffing against stale coordinates and
      // splatting a spurious jump.
      if (canvasEl) {
        canvasEl.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false, cancelable: false }));
      }
      const remaining = touches.keys().next().value;
      primaryId = remaining;
      mode = "paint";
    }
  }

  function onWindowPointerMove(event) {
    if (event.pointerType !== "touch") return;
    if (!touches.has(event.pointerId)) return;
    const last = touches.get(event.pointerId);
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (mode === "rotate" && event.pointerId === primaryId) {
      onRotateMove(dx, dy);
    }
  }

  function onWindowPointerUp(event) {
    if (event.pointerType !== "touch") return;
    endTouch(event.pointerId);
  }

  // Capture phase on window too, and not just for symmetry with the
  // wrapper listeners: window precedes the wrapper in the capture
  // traversal (window -> document -> ... -> wrapperEl -> target), so a
  // capture-phase listener here always sees the event before
  // onWrapperPointerMoveCapture's stopPropagation (during rotate) can cut
  // the dispatch short. A bubble-phase listener here would never fire in
  // that case, since stopPropagation during capture halts the entire
  // dispatch, including the later bubble phase back up to window.
  wrapperEl.addEventListener("pointerdown", onWrapperPointerDownCapture, true);
  wrapperEl.addEventListener("pointermove", onWrapperPointerMoveCapture, true);
  window.addEventListener("pointermove", onWindowPointerMove, true);
  window.addEventListener("pointerup", onWindowPointerUp, true);
  window.addEventListener("pointercancel", onWindowPointerUp, true);

  function dispose() {
    wrapperEl.removeEventListener("pointerdown", onWrapperPointerDownCapture, true);
    wrapperEl.removeEventListener("pointermove", onWrapperPointerMoveCapture, true);
    window.removeEventListener("pointermove", onWindowPointerMove, true);
    window.removeEventListener("pointerup", onWindowPointerUp, true);
    window.removeEventListener("pointercancel", onWindowPointerUp, true);
  }

  return { dispose };
}

function loadImageTexture(src, onLoad) {
  const loader = new THREE.TextureLoader();
  loader.load(src, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    onLoad(tex);
  });
}

// Waits for ShaderLabComposition's own <canvas> to appear inside `wrapper`
// (React creates it as part of its normal render/commit, asynchronously
// relative to this call).
function waitForChildCanvas(wrapper) {
  return new Promise((resolve) => {
    const existing = wrapper.querySelector("canvas");
    if (existing) {
      resolve(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const canvas = wrapper.querySelector("canvas");
      if (canvas) {
        observer.disconnect();
        resolve(canvas);
      }
    });
    observer.observe(wrapper, { childList: true, subtree: true });
  });
}

// Sets up the full paint-to-reveal vinyl record -- same mechanism as
// vinylprocess's <HoverRevealShader>, ported off React Three Fiber onto a
// plain setup()+tick() pair. `canvas` is the tile's own visible WebGPU
// canvas; `fluidWrapperEl` is a hidden sibling div the fluid composition's
// React root mounts into; `isFocusedFn` gates painting/orbit to only run
// while this gallery tile is the focused one.
export function createVinylReveal({
  canvas,
  fluidWrapperEl,
  layer1Src,
  layer2Src,
  layer3Src,
  modelUrl,
  tileWidth,
  tileHeight,
  isFocusedFn,
}) {
  let disposed = false;
  const group = new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(group);
  const camera = new THREE.PerspectiveCamera(35, tileWidth / tileHeight, 0.01, 10);
  camera.position.set(0, 0.9, 2.4);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);
  const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.4);
  dirLight1.position.set(2, 3, 4);
  scene.add(dirLight1);
  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
  dirLight2.position.set(-2, -1, -3);
  scene.add(dirLight2);

  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  // Matches R3F's <Canvas> defaults (which the TSX version relies on
  // implicitly) so colors render the same as vinylprocess.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setSize(tileWidth, tileHeight, false);
  // WebGPURenderer needs an async device/adapter negotiation before first
  // use (R3F's <Canvas> does this itself via an async `gl` prop in the TSX
  // version); everything renderer-touching below waits on this.
  let rendererReady = false;
  const rendererInit = renderer.init().then(() => {
    rendererReady = true;
  });

  let mask1 = null;
  let mask2GateHandle = null;
  let mask2 = null;
  let orbitHandle = null;
  let touchGestureHandle = null;
  let framed = false;
  let wasFocused = false;
  let focusStartedAt = null;

  const textures = { layer1: null, layer2: null, layer3: null };
  let materialsBuilt = false;
  let preparedScene = null;
  const gltfSceneRef = { current: null };

  function buildRevealMaterial(uvNode) {
    if (!textures.layer1 || !textures.layer2 || !textures.layer3 || !mask1.node || !mask2.node) {
      return null;
    }
    const mat = new MeshBasicNodeMaterial();
    const layer1Node = tslTexture(textures.layer1, uvNode);
    const layer2Node = tslTexture(textures.layer2, uvNode);
    const layer3Node = tslTexture(textures.layer3, uvNode);
    const revealOpacity1 = smoothstep(REVEAL_LOW, REVEAL_HIGH, mask1.node.r);
    const revealOpacity2raw = smoothstep(REVEAL_LOW, REVEAL_HIGH, mask2.node.r);
    // Hard guarantee that layer3 can only be as visible here as layer1
    // already is -- makes the ordering unconditional, on top of the
    // stroke-snapshot gate.
    const revealOpacity2 = revealOpacity2raw.mul(revealOpacity1);
    const stage1 = mix(layer1Node.rgb, layer2Node.rgb, revealOpacity1);
    const stage2 = mix(stage1, layer3Node.rgb, revealOpacity2);
    mat.colorNode = vec4(stage2, 1);
    return mat;
  }

  function tryBuildMaterials(gltfScene) {
    if (materialsBuilt) return;
    if (!gltfScene) return;
    if (!textures.layer1 || !textures.layer2 || !textures.layer3) return;
    if (!mask1 || !mask1.node || !mask2 || !mask2.node) return;

    const surfaceMaterial = buildRevealMaterial(uv());
    const labelMaterial = buildRevealMaterial(
      vec2(positionLocal.x, positionLocal.y.mul(-1))
        .div(LABEL_LOCAL_RADIUS)
        .mul(LABEL_IMAGE_RADIUS)
        .add(0.5)
    );
    if (!surfaceMaterial) return;

    const cloned = gltfScene.clone(true);
    cloned.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const name = child.material.name;
      if (name === RECORD_SURFACE_MATERIAL_NAME && surfaceMaterial) {
        child.material = surfaceMaterial;
      } else if (name === RECORD_LABEL_MATERIAL_NAME && labelMaterial) {
        child.material = labelMaterial;
      }
    });

    preparedScene = cloned;
    group.add(cloned);
    materialsBuilt = true;

    if (!framed) {
      const box = new THREE.Box3().setFromObject(cloned);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const fovRad = (camera.fov * Math.PI) / 180;
      const distance = (maxDim / 2 / Math.tan(fovRad / 2)) * 1.5;

      camera.position.set(0, maxDim * 0.18, distance);
      camera.near = distance / 100;
      camera.far = distance * 10;
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();

      group.position.set(-center.x, -center.y, -center.z);
      framed = true;
    }
  }

  loadImageTexture(layer1Src, (tex) => {
    textures.layer1 = tex;
    tryBuildMaterials(gltfSceneRef.current);
  });
  loadImageTexture(layer2Src, (tex) => {
    textures.layer2 = tex;
    tryBuildMaterials(gltfSceneRef.current);
  });
  loadImageTexture(layer3Src, (tex) => {
    textures.layer3 = tex;
    tryBuildMaterials(gltfSceneRef.current);
  });

  new GLTFLoader().load(modelUrl, (gltf) => {
    gltfSceneRef.current = gltf.scene;
    tryBuildMaterials(gltf.scene);
  });

  // React island: mount ShaderLabComposition (the fluid paint sim) into
  // the hidden wrapper, wait for its own <canvas> to exist, then wire up
  // mask1 -> mask2GateRef -> mask2, matching VinylRecord's wiring exactly.
  // All of this touches `renderer` (setRenderTarget/clear/render), so it
  // waits on rendererInit first.
  const reactRoot = createRoot(fluidWrapperEl);
  reactRoot.render(
    React.createElement(ShaderLabComposition, {
      config: fluidMaskConfig,
      onRuntimeError: (message) => {
        console.error("[vinyl-reveal] fluid runtime error:", message);
      },
    })
  );

  // The fluid library's own FluidPass splats on every pointermove/pointerdown
  // it sees, regardless of button state -- there's no config for "only
  // while dragging", and no concept of this gallery's own focus state.
  // createTouchGestureController owns the wrapper-capture interception that
  // gates this (mouse hover-paint gating + touch 1-finger-paint/2-finger-
  // rotate disambiguation), replacing the old standalone blockHoverPaint.
  let maskCanvas = null;
  Promise.all([rendererInit, waitForChildCanvas(fluidWrapperEl)]).then(([, canvasEl]) => {
    if (disposed) return;
    maskCanvas = canvasEl;

    mask1 = createLatchedMask(renderer, maskCanvas, {
      outputUv: viewportMaskUv,
      creepGain: CREEP_GAIN,
    });
    mask2GateHandle = createStrokeSnapshotTexture(renderer, maskCanvas, mask1.latchRef, isFocusedFn);
    mask2 = createLatchedMask(renderer, maskCanvas, {
      outputUv: viewportMaskUv,
      creepGain: CREEP_GAIN,
      gateRef: mask2GateHandle.snapshotRef,
    });

    orbitHandle = createManualOrbit(maskCanvas, group, isFocusedFn);
    touchGestureHandle = createTouchGestureController(fluidWrapperEl, canvasEl, isFocusedFn, {
      onPaintStart: () => mask2GateHandle.markPending(),
      onRotateMove: (dx, dy) => orbitHandle.applyDelta(dx, dy),
    });

    tryBuildMaterials(gltfSceneRef.current);
  });

  function resetReveal() {
    if (mask1) mask1.reset();
    if (mask2GateHandle) mask2GateHandle.reset();
    if (mask2) mask2.reset();
  }

  function tick() {
    if (disposed || !rendererReady) return;

    const focusedNow = isFocusedFn();
    if (focusedNow && !wasFocused) {
      // Just entered focus -- start the unlock countdown.
      focusStartedAt = Date.now();
    } else if (!focusedNow && wasFocused) {
      // Just left focus -- wipe the reveal back to layer1 so painting can
      // be played through again next time this tile is focused.
      resetReveal();
      focusStartedAt = null;
    }
    wasFocused = focusedNow;

    // Belt-and-suspenders on top of blockHoverPaint's event-level gating
    // (which only stops pointermove, not pointerdown, matching
    // vinylprocess's own rationale -- a rationale that doesn't fully hold
    // here, since a stray pointerdown can still reach the fluid library
    // before this tile is ever focused, e.g. while dragging to scroll the
    // wallpaper past it). Not calling update() at all while unfocused, or
    // within REVEAL_UNLOCK_DELAY_MS of becoming focused, means the masks
    // are provably frozen -- nothing the fluid canvas is doing underneath
    // can move the reveal unless this tile is focused and settled, full
    // stop, regardless of what leaks through the DOM event layer.
    const unlocked =
      focusedNow && focusStartedAt !== null && Date.now() - focusStartedAt >= REVEAL_UNLOCK_DELAY_MS;
    if (unlocked) {
      if (mask1) mask1.update();
      if (mask2GateHandle) mask2GateHandle.update();
      if (mask2) mask2.update();
    }

    if (canvas.width !== tileWidth || canvas.height !== tileHeight) {
      renderer.setSize(tileWidth, tileHeight, false);
      camera.aspect = tileWidth / tileHeight;
      camera.updateProjectionMatrix();
    }

    renderer.render(scene, camera);
  }

  function dispose() {
    disposed = true;
    if (touchGestureHandle) touchGestureHandle.dispose();
    if (orbitHandle) orbitHandle.dispose();
    if (mask1) mask1.dispose();
    if (mask2GateHandle) mask2GateHandle.dispose();
    if (mask2) mask2.dispose();
    reactRoot.unmount();
    renderer.dispose();
  }

  return { tick, dispose };
}
