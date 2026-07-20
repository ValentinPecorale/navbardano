# Figma → Code: A Design Engineer's Translation Guide

For a product/brand designer who ships — human taste + AI-assisted dev.
Frontend only. No backend. Goal: know exactly which language/tool to reach for, for any design or interaction.

---

## 1. The Frontend Stack, in Plain Terms

Three languages. Each does ONE job. Almost every interaction question you'll ever have is really the question "which of these three handles this part?"

| Language | Job | Think of it as |
|---|---|---|
| **HTML** | Structure / what exists on the page | The skeleton — divs, buttons, text, images |
| **CSS** | Appearance + simple motion | The skin, makeup, and *simple* choreography |
| **JavaScript (JS)** | Logic, state, and *responding* to things | The nervous system — listens, decides, reacts |

Rule of thumb:
- If it's about **how something looks** (color, spacing, radius, font) → CSS.
- If it's a **simple, self-contained animation** (hover, fade in, slide) → CSS.
- If it needs to **know something** (scroll position, mouse position, what the user clicked, data from elsewhere) → JS.
- If it's **complex choreography** (sequencing, easing curves, scrubbing, physics) → JS + an animation library (below), not raw CSS.

You will almost never touch a "backend language" (Python, Node servers, databases) for the kind of work you're describing. Skip that entirely for now.

---

## 2. The Animation Toolbox (in order of power/complexity)

| Tool | What it's for | When to reach for it |
|---|---|---|
| **CSS `transition`** | Smooth change between two states (A → B) | Hover states, color changes, simple show/hide |
| **CSS `animation` + `@keyframes`** | Looping or multi-step animation with no JS logic | Loaders, marquees, pulsing, background motion |
| **CSS `transform` (translate/scale/rotate)** | Moving/scaling elements cheaply (GPU-accelerated) | Any movement — always prefer this over animating `top/left/width` |
| **JavaScript (vanilla)** | Reading input (mouse, scroll, click) and toggling state/classes | Cursor trails, custom dropdowns, anything reactive |
| **GSAP** | Industrial-strength animation engine — timelines, easing, scroll-triggers | Complex sequenced animations, scroll-linked reveals, most "award-winning site" motion |
| **Framer Motion / Motion (React)** | Declarative animation tied to component state | If you're building in React — page transitions, layout animation, gestures |
| **Lenis** | Smooth scroll library | Any site with that buttery "smooth scroll" feel |
| **Three.js / WebGL / Shaders** | 3D, particles, generative visuals | Advanced — hero backgrounds, distortion effects, image reveals with shaders |
| **Rive / Lottie** | Designer-authored animation (made in a tool, played back in code) | Complex character/icon animation your dev doesn't hand-code |

---

## 3. Interaction Encyclopedia: Your Effects → The Right Tool

| Effect | Primary tool | Notes |
|---|---|---|
| **Hover state** (button, link) | CSS `transition` | No JS needed, ever |
| **Dropdown / accordion** | HTML + CSS + a little JS | JS toggles a class or `open` attribute; CSS handles the animation (height/opacity/transform) |
| **Page transitions** | JS (View Transitions API) or Framer Motion (if React) | The browser-native **View Transitions API** is the modern, framework-free way to do this now |
| **Parallax** | CSS (`background-attachment`) for simple; JS (scroll listener) or GSAP ScrollTrigger for layered/custom | True multi-layer parallax = JS |
| **Cursor trail** | JS (mousemove listener) + CSS transforms, or Canvas/WebGL for dense particle trails | Track mouse position in JS, animate follower elements with `transform` |
| **Mask reveal** (image/text wipes into view) | CSS `clip-path` for simple; GSAP + `clip-path`/SVG mask for scroll-triggered | This is a CSS *property* animated by JS/GSAP |
| **Scroll-triggered reveal** (fade/slide in as you scroll) | Intersection Observer (JS) + CSS transitions, or GSAP ScrollTrigger | Intersection Observer = the modern vanilla-JS way to detect "element entered viewport" |
| **Magnetic button** (button pulls toward cursor) | JS (mousemove) + CSS `transform: translate()` | Small JS snippet, CSS does the visual move |
| **Marquee / infinite scroll ticker** | Pure CSS `@keyframes` | No JS required |
| **Smooth scroll / scroll-jacking feel** | Lenis (JS library) | Wraps your whole page's scroll behavior |
| **Text scramble / typewriter** | JS (string manipulation on an interval) + CSS for caret | Small vanilla JS |
| **Drag-to-reorder / draggable cards** | JS (Pointer Events) or a library like Framer Motion's `drag` prop | Physics/inertia = library territory |
| **Custom cursor** | JS (mousemove) positions a fixed CSS element | Simple state tracking |
| **Image hover distortion / liquid effect** | WebGL/Shaders (via a library like `curtains.js` or raw Three.js) | This is the deep end — only reach here when CSS/JS genuinely can't do it |

**The pattern you'll notice:** CSS handles *how it looks mid-animation*. JS handles *when/why it starts*. Libraries (GSAP, Framer Motion) exist to make the JS part less painful for complex timing.

---

## 4. The Figma → Code Checklist

When you're staring at a Figma file and need to translate it, extract these five things per element:

1. **Structure** — What HTML element is this actually? (button, nav, list, section, image). Figma layers don't map 1:1 — you're deciding semantics here.
2. **Static styles** → CSS
   - Auto Layout → `display: flex` or `grid`, with `gap`
   - Spacing (padding/margin values)
   - Corner radius → `border-radius`
   - Fill/stroke → `background`/`border`
   - Typography (family, size, weight, line-height, letter-spacing)
   - Shadows/blurs → `box-shadow`/`filter`
3. **Responsive behavior** — What breaks/reflows at what width? (Figma variants/breakpoints → CSS media queries or container queries)
4. **Prototype interactions** (the arrows/triggers in Figma's Prototype tab) — these ARE your animation spec:
   - "On Click, Navigate to" → page transition
   - "On Hover, Change to" → CSS transition
   - "While Scrolling" → scroll-triggered JS/GSAP
   - "Smart Animate" → this is Figma's built-in tweening; in code this becomes a CSS transition or GSAP `.to()` between two states
5. **Easing curve** — Figma shows you the easing (ease-in-out, spring, etc.) in the prototype panel. Copy the exact curve — this is what makes motion feel "designed" instead of default.

**Tip:** I have a Figma connector available. If you drop in a Figma file/frame link, I can pull the actual design context (spacing, tokens, layer structure) directly instead of you eyeballing it — just say the word.

---

## 5. A Learning Path (in order)

1. **HTML + CSS fundamentals** — box model, flexbox, grid, positioning. This is 80% of static Figma translation.
2. **CSS transitions & transforms** — covers most "polish" interactions (hovers, simple reveals).
3. **CSS `@keyframes`** — loops, marquees, multi-step animation without JS.
4. **Vanilla JS basics** — variables, functions, event listeners (`click`, `mousemove`, `scroll`), and DOM methods (`classList.add/remove`, `querySelector`).
5. **Intersection Observer** — the single most useful JS API for scroll-reveal effects.
6. **GSAP** — once vanilla JS timing gets annoying, GSAP is the industry-standard jump. Learn `.timeline()` and `ScrollTrigger` specifically.
7. **A component framework (React)** — only once you're building multi-page products, not just single interactive pieces. Pairs with Framer Motion.
8. **WebGL/shaders** — optional, deep-end, for signature hero-section moments.

---

## 6. Quick Decision Tree

```
Is it just a visual change on hover/focus/state? → CSS transition
Does it loop or self-play with no trigger?        → CSS @keyframes
Does it need mouse position or scroll position?    → JS (+ CSS transform for the visual)
Is it multiple elements choreographed together?     → GSAP timeline
Is it tied to React component state/routing?        → Framer Motion
Is it full-page, unconventional, generative?        → WebGL/Three.js
```

---

*Next step: send me a Figma frame or describe one interaction at a time, and I'll help you build it — code + explanation of why that tool was the right call, so the pattern sticks.*
