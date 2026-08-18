// Fluid (Navier-Stokes) + ordered dithering + pixelation, layered as a
// post-process chain: fluid sim -> dither -> pixelate -> canvas.
// Ported from @basementstudio/shader-lab's TSL/WebGPU passes to plain
// Three.js WebGLRenderer + GLSL, to run on navbardano's no-bundler setup.
// Config values (monoDark/monoLight, dither params, cellSize) are copied
// 1:1 from the ExportedShader.tsx composition so the look matches.
import * as THREE from "three";

const CONFIG = {
  fluid: {
    simRes: 224,
    dyeRes: 384,
    iterations: 20,
    densityDissipation: 1.21,
    velocityDissipation: 2.73,
    pressureDissipation: 0.78,
    curlStrength: 0,
    radius: 0.15,
    splatForce: 2400,
    brightness: 1.6,
    monoDark: new THREE.Color(0xff0000),
    monoLight: new THREE.Color(0x000000),
    seed: 1337,
  },
  dither: {
    matrixSize: 4,
    levels: 3,
    spread: 0.33,
    dotScale: 0.3,
  },
  pixel: {
    cellSize: 10,
    aspectRatio: 0.95,
  },
};

const MOBILE_BREAKPOINT = 640;

function createSeededRandom(seed) {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return { r: v, g: t, b: p };
    case 1:
      return { r: q, g: v, b: p };
    case 2:
      return { r: p, g: v, b: t };
    case 3:
      return { r: p, g: q, b: v };
    case 4:
      return { r: t, g: p, b: v };
    default:
      return { r: v, g: p, b: q };
  }
}

function randomVividColor(random) {
  const c = hsvToRgb(random(), 1, 1);
  return { r: c.r * 0.15, g: c.g * 0.15, b: c.b * 0.15 };
}

function getSimulationSize(resolution, aspectRatio) {
  if (aspectRatio >= 1) {
    return {
      width: Math.max(1, Math.round(resolution * aspectRatio)),
      height: Math.max(1, Math.round(resolution)),
    };
  }
  return {
    width: Math.max(1, Math.round(resolution)),
    height: Math.max(1, Math.round(resolution / Math.max(aspectRatio, 0.0001))),
  };
}

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BILERP = /* glsl */ `
  vec4 bilerp(sampler2D tex, vec2 uv, vec2 texelSize) {
    vec2 st = uv / texelSize - 0.5;
    vec2 iuv = floor(st);
    vec2 fuv = fract(st);
    vec4 a = texture2D(tex, (iuv + vec2(0.5, 0.5)) * texelSize);
    vec4 b = texture2D(tex, (iuv + vec2(1.5, 0.5)) * texelSize);
    vec4 c = texture2D(tex, (iuv + vec2(0.5, 1.5)) * texelSize);
    vec4 d = texture2D(tex, (iuv + vec2(1.5, 1.5)) * texelSize);
    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
  }
`;

const SHADERS = {
  splat: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform vec2 uPoint;
    uniform vec3 uColor;
    uniform float uAspect;
    uniform float uRadius;
    void main() {
      vec2 delta = vUv - uPoint;
      delta.x *= uAspect;
      float d = exp(-dot(delta, delta) / uRadius);
      vec3 base = texture2D(uTarget, vUv).xyz;
      gl_FragColor = vec4(base + uColor * d, 1.0);
    }
  `,
  advection: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 uTexelSize;
    uniform vec2 uSourceTexelSize;
    uniform float uDt;
    uniform float uDissipation;
    ${BILERP}
    void main() {
      vec2 vel = bilerp(uVelocity, vUv, uTexelSize).xy;
      vec2 coord = vUv - vel * uTexelSize * uDt;
      vec4 result = bilerp(uSource, coord, uSourceTexelSize);
      float decay = 1.0 + uDissipation * uDt;
      gl_FragColor = result / decay;
    }
  `,
  divergence: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform vec2 uTexelSize;
    void main() {
      float L = texture2D(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).x;
      float R = texture2D(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).x;
      float T = texture2D(uVelocity, vUv + vec2(0.0, uTexelSize.y)).y;
      float B = texture2D(uVelocity, vUv - vec2(0.0, uTexelSize.y)).y;
      vec2 C = texture2D(uVelocity, vUv).xy;
      if (vUv.x - uTexelSize.x < 0.0) L = -C.x;
      if (vUv.x + uTexelSize.x > 1.0) R = -C.x;
      if (vUv.y + uTexelSize.y > 1.0) T = -C.y;
      if (vUv.y - uTexelSize.y < 0.0) B = -C.y;
      float div = 0.5 * (R - L + T - B);
      gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
  `,
  pressure: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    uniform vec2 uTexelSize;
    void main() {
      float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
      float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
      float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
      float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
      float div = texture2D(uDivergence, vUv).x;
      float p = (L + R + B + T - div) * 0.25;
      gl_FragColor = vec4(p, 0.0, 0.0, 1.0);
    }
  `,
  gradientSubtract: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    uniform vec2 uTexelSize;
    void main() {
      float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
      float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
      float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
      float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
      vec2 vel = texture2D(uVelocity, vUv).xy;
      vel -= vec2(R - L, T - B);
      gl_FragColor = vec4(vel, 0.0, 1.0);
    }
  `,
  clear: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float uPressureDissipation;
    void main() {
      gl_FragColor = texture2D(uTexture, vUv) * uPressureDissipation;
    }
  `,
  display: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float uExposure;
    uniform vec3 uMonoDark;
    uniform vec3 uMonoLight;
    void main() {
      vec3 src = 1.0 - exp(-texture2D(uTexture, vUv).rgb * uExposure);
      src = pow(src, vec3(0.85));
      float luma = dot(src, vec3(0.299, 0.587, 0.114));
      vec3 color = mix(uMonoDark, uMonoLight, luma);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
  dither: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uSource;
    uniform vec2 uResolution;
    uniform float uLevels;
    uniform float uSpread;
    uniform float uDotScale;
    float bayer4x4(vec2 cell) {
      float x = mod(cell.x, 4.0);
      float y = mod(cell.y, 4.0);
      mat4 m = mat4(
        0.0,  8.0,  2.0, 10.0,
        12.0, 4.0, 14.0,  6.0,
        3.0, 11.0,  1.0,  9.0,
        15.0, 7.0, 13.0,  5.0
      );
      return m[int(y)][int(x)];
    }
    void main() {
      vec2 cellCoord = floor(vUv * uResolution);
      vec2 snappedUv = (cellCoord + 0.5) / uResolution;
      vec3 src = texture2D(uSource, snappedUv).rgb;
      float bayer = (bayer4x4(cellCoord) + 0.5) / 16.0;
      float threshold = bayer - 0.5;
      float levelsMinusOne = max(uLevels - 1.0, 1.0);
      vec3 adjusted = src + threshold * uSpread;
      vec3 quantized = clamp(floor(adjusted * levelsMinusOne + 0.5) / levelsMinusOne, 0.0, 1.0);
      vec2 cellFrac = fract(vUv * uResolution);
      vec2 centered = cellFrac - 0.5;
      float dist = max(abs(centered.x), abs(centered.y));
      float halfSize = 0.5 * uDotScale;
      float mask = smoothstep(halfSize, halfSize - 0.01, dist);
      gl_FragColor = vec4(quantized * mask, 1.0);
    }
  `,
  pixelate: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uSource;
    uniform vec2 uResolution;
    uniform float uCellSize;
    uniform float uAspectRatio;
    void main() {
      vec2 cell = vec2(uCellSize / uResolution.x, (uCellSize * uAspectRatio) / uResolution.y);
      vec2 cellIndex = floor(vUv / cell);
      vec2 cellCenterUv = (cellIndex + 0.5) * cell;
      gl_FragColor = vec4(texture2D(uSource, cellCenterUv).rgb, 1.0);
    }
  `,
};

class FluidCmsBackground {
  constructor(canvas, section) {
    this.canvas = canvas;
    this.section = section;
    this.random = createSeededRandom(CONFIG.fluid.seed);
    this.pointer = { x: 0, y: 0, has: false };
    this.running = false;
    this.width = 1;
    this.height = 1;

    const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    this.dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5);
    this.simRes = isMobile ? 128 : CONFIG.fluid.simRes;
    this.dyeRes = isMobile ? 256 : CONFIG.fluid.dyeRes;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial());
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.buildMaterials();
    this.resize();
    this.bindPointer();

    this.onWindowResize = () => this.resize();
    window.addEventListener("resize", this.onWindowResize);

    this.lastTime = performance.now();
    this.tick = this.tick.bind(this);
  }

  buildMaterials() {
    const rtOptions = {
      depthBuffer: false,
      stencilBuffer: false,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
    };
    const nearest = { ...rtOptions, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    const linear = { ...rtOptions, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rtOptionsNearest = nearest;
    this.rtOptionsLinear = linear;

    const mat = (fragmentShader, uniforms) =>
      new THREE.ShaderMaterial({ vertexShader: VERTEX_SHADER, fragmentShader, uniforms, depthTest: false, depthWrite: false });

    this.splatMaterial = mat(SHADERS.splat, {
      uTarget: { value: null },
      uPoint: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Vector3() },
      uAspect: { value: 1 },
      uRadius: { value: CONFIG.fluid.radius / 100 },
    });
    this.advectionMaterial = mat(SHADERS.advection, {
      uVelocity: { value: null },
      uSource: { value: null },
      uTexelSize: { value: new THREE.Vector2() },
      uSourceTexelSize: { value: new THREE.Vector2() },
      uDt: { value: 1 / 60 },
      uDissipation: { value: 0 },
    });
    this.divergenceMaterial = mat(SHADERS.divergence, {
      uVelocity: { value: null },
      uTexelSize: { value: new THREE.Vector2() },
    });
    this.pressureMaterial = mat(SHADERS.pressure, {
      uPressure: { value: null },
      uDivergence: { value: null },
      uTexelSize: { value: new THREE.Vector2() },
    });
    this.gradientSubtractMaterial = mat(SHADERS.gradientSubtract, {
      uPressure: { value: null },
      uVelocity: { value: null },
      uTexelSize: { value: new THREE.Vector2() },
    });
    this.clearMaterial = mat(SHADERS.clear, {
      uTexture: { value: null },
      uPressureDissipation: { value: CONFIG.fluid.pressureDissipation },
    });
    this.displayMaterial = mat(SHADERS.display, {
      uTexture: { value: null },
      uExposure: { value: CONFIG.fluid.brightness },
      uMonoDark: { value: new THREE.Vector3(CONFIG.fluid.monoDark.r, CONFIG.fluid.monoDark.g, CONFIG.fluid.monoDark.b) },
      uMonoLight: { value: new THREE.Vector3(CONFIG.fluid.monoLight.r, CONFIG.fluid.monoLight.g, CONFIG.fluid.monoLight.b) },
    });
    this.ditherMaterial = mat(SHADERS.dither, {
      uSource: { value: null },
      uResolution: { value: new THREE.Vector2() },
      uLevels: { value: CONFIG.dither.levels },
      uSpread: { value: CONFIG.dither.spread },
      uDotScale: { value: CONFIG.dither.dotScale },
    });
    this.pixelateMaterial = mat(SHADERS.pixelate, {
      uSource: { value: null },
      uResolution: { value: new THREE.Vector2() },
      uCellSize: { value: CONFIG.pixel.cellSize },
      uAspectRatio: { value: CONFIG.pixel.aspectRatio },
    });
  }

  createDouble(width, height, options) {
    return {
      read: new THREE.WebGLRenderTarget(width, height, options),
      write: new THREE.WebGLRenderTarget(width, height, options),
      swap() {
        const tmp = this.read;
        this.read = this.write;
        this.write = tmp;
      },
    };
  }

  renderPass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    // The CMS section is width:100vw/height:100vh but animates height:0 -> 100vh
    // on reveal (accordion transition). Size off the viewport instead of the
    // section's live rect so buffers never get built at a mid-transition height
    // and don't thrash on every animation frame.
    const width = Math.max(1, Math.round(window.innerWidth));
    const height = Math.max(1, Math.round(window.innerHeight));
    if (width === this.width && height === this.height && this.velocity) return;
    this.width = width;
    this.height = height;

    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(width, height, false);
    const pixelWidth = Math.max(1, Math.round(width * this.dpr));
    const pixelHeight = Math.max(1, Math.round(height * this.dpr));
    const aspect = pixelWidth / pixelHeight;

    this.velocity?.read.dispose();
    this.velocity?.write.dispose();
    this.density?.read.dispose();
    this.density?.write.dispose();
    this.pressure?.read.dispose();
    this.pressure?.write.dispose();
    this.divergenceTarget?.dispose();
    this.displayTarget?.dispose();
    this.ditherTarget?.dispose();

    this.simSize = getSimulationSize(this.simRes, aspect);
    this.dyeSize = getSimulationSize(this.dyeRes, aspect);
    this.velocity = this.createDouble(this.simSize.width, this.simSize.height, this.rtOptionsNearest);
    this.density = this.createDouble(this.dyeSize.width, this.dyeSize.height, this.rtOptionsLinear);
    this.pressure = this.createDouble(this.simSize.width, this.simSize.height, this.rtOptionsNearest);
    this.divergenceTarget = new THREE.WebGLRenderTarget(this.simSize.width, this.simSize.height, this.rtOptionsNearest);
    this.displayTarget = new THREE.WebGLRenderTarget(pixelWidth, pixelHeight, this.rtOptionsLinear);
    this.ditherTarget = new THREE.WebGLRenderTarget(pixelWidth, pixelHeight, this.rtOptionsLinear);

    this.simTexel = new THREE.Vector2(1 / this.simSize.width, 1 / this.simSize.height);
    this.dyeTexel = new THREE.Vector2(1 / this.dyeSize.width, 1 / this.dyeSize.height);
    this.splatMaterial.uniforms.uAspect.value = aspect;
    this.ditherMaterial.uniforms.uResolution.value.set(pixelWidth, pixelHeight);
    this.pixelateMaterial.uniforms.uResolution.value.set(pixelWidth, pixelHeight);

    this.seedInitialSplats();
  }

  splat(x, y, dx, dy, color) {
    this.splatMaterial.uniforms.uPoint.value.set(x, y);

    this.splatMaterial.uniforms.uTarget.value = this.velocity.read.texture;
    this.splatMaterial.uniforms.uColor.value.set(dx, dy, 0);
    this.renderPass(this.splatMaterial, this.velocity.write);
    this.velocity.swap();

    this.splatMaterial.uniforms.uTarget.value = this.density.read.texture;
    const dye = color ?? randomVividColor(this.random);
    this.splatMaterial.uniforms.uColor.value.set(dye.r, dye.g, dye.b);
    this.renderPass(this.splatMaterial, this.density.write);
    this.density.swap();
  }

  seedInitialSplats() {
    for (let i = 0; i < 8; i += 1) {
      const x = 0.15 + this.random() * 0.7;
      const y = 0.2 + this.random() * 0.6;
      const angle = this.random() * Math.PI * 2;
      const force = 800 + this.random() * 600;
      this.splat(x, y, Math.cos(angle) * force, Math.sin(angle) * force, randomVividColor(this.random));
    }
  }

  bindPointer() {
    let last = null;
    const onMove = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const ux = localX / rect.width;
      const uy = 1 - localY / rect.height;
      if (last) {
        const force = CONFIG.fluid.splatForce;
        const dx = ((localX - last.x) / rect.width) * force;
        const dy = -((localY - last.y) / rect.height) * force;
        if (dx !== 0 || dy !== 0) this.splat(ux, uy, dx, dy);
      }
      last = { x: localX, y: localY };
    };
    const onLeave = () => {
      last = null;
    };
    this.section.addEventListener("pointermove", onMove);
    this.section.addEventListener("pointerdown", onMove);
    this.section.addEventListener("pointerleave", onLeave);
  }

  step(dt) {
    const simTexel = this.simTexel;

    this.divergenceMaterial.uniforms.uVelocity.value = this.velocity.read.texture;
    this.divergenceMaterial.uniforms.uTexelSize.value = simTexel;
    this.renderPass(this.divergenceMaterial, this.divergenceTarget);

    this.clearMaterial.uniforms.uTexture.value = this.pressure.read.texture;
    this.renderPass(this.clearMaterial, this.pressure.write);
    this.pressure.swap();

    for (let i = 0; i < CONFIG.fluid.iterations; i += 1) {
      this.pressureMaterial.uniforms.uPressure.value = this.pressure.read.texture;
      this.pressureMaterial.uniforms.uDivergence.value = this.divergenceTarget.texture;
      this.pressureMaterial.uniforms.uTexelSize.value = simTexel;
      this.renderPass(this.pressureMaterial, this.pressure.write);
      this.pressure.swap();
    }

    this.gradientSubtractMaterial.uniforms.uPressure.value = this.pressure.read.texture;
    this.gradientSubtractMaterial.uniforms.uVelocity.value = this.velocity.read.texture;
    this.gradientSubtractMaterial.uniforms.uTexelSize.value = simTexel;
    this.renderPass(this.gradientSubtractMaterial, this.velocity.write);
    this.velocity.swap();

    this.advectionMaterial.uniforms.uVelocity.value = this.velocity.read.texture;
    this.advectionMaterial.uniforms.uSource.value = this.velocity.read.texture;
    this.advectionMaterial.uniforms.uTexelSize.value = simTexel;
    this.advectionMaterial.uniforms.uSourceTexelSize.value = simTexel;
    this.advectionMaterial.uniforms.uDt.value = dt;
    this.advectionMaterial.uniforms.uDissipation.value = CONFIG.fluid.velocityDissipation;
    this.renderPass(this.advectionMaterial, this.velocity.write);
    this.velocity.swap();

    this.advectionMaterial.uniforms.uVelocity.value = this.velocity.read.texture;
    this.advectionMaterial.uniforms.uSource.value = this.density.read.texture;
    this.advectionMaterial.uniforms.uTexelSize.value = simTexel;
    this.advectionMaterial.uniforms.uSourceTexelSize.value = this.dyeTexel;
    this.advectionMaterial.uniforms.uDt.value = dt;
    this.advectionMaterial.uniforms.uDissipation.value = CONFIG.fluid.densityDissipation;
    this.renderPass(this.advectionMaterial, this.density.write);
    this.density.swap();

    this.displayMaterial.uniforms.uTexture.value = this.density.read.texture;
    this.renderPass(this.displayMaterial, this.displayTarget);

    this.ditherMaterial.uniforms.uSource.value = this.displayTarget.texture;
    this.renderPass(this.ditherMaterial, this.ditherTarget);

    this.pixelateMaterial.uniforms.uSource.value = this.ditherTarget.texture;
    this.renderer.setRenderTarget(null);
    this.quad.material = this.pixelateMaterial;
    this.renderer.render(this.scene, this.camera);
  }

  tick(now) {
    if (!this.running) return;
    const dt = Math.min(Math.max((now - this.lastTime) / 1000, 1 / 240), 1 / 20);
    this.lastTime = now;
    if (this.section.clientHeight > 0) {
      this.step(dt);
    }
    requestAnimationFrame(this.tick);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
  }
}

function init() {
  const canvas = document.querySelector("[data-bg-shader-cms]");
  const section = document.querySelector("[data-viewport-wrapper-cms]");
  if (!canvas || !section) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) return;

  let gl;
  try {
    gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  } catch (err) {
    gl = null;
  }
  if (!gl) return;

  const bg = new FluidCmsBackground(canvas, section);
  bg.start();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) bg.stop();
    else bg.start();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
