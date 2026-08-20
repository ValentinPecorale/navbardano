function initNavbar(nav) {
  const navItems = nav.querySelectorAll("[data-nav-item]");
  const highlight = nav.querySelector("[data-nav-highlight]");
  const navTrack = nav.querySelector(".nav-track");

  function moveHighlightTo(item, { instant = false } = {}) {
    const itemRect = item.getBoundingClientRect();
    const trackRect = navTrack.getBoundingClientRect();
    const width = itemRect.width;
    const x = itemRect.left - trackRect.left;

    if (instant) {
      // Jump straight to position/size with no slide — only opacity should animate.
      highlight.style.transitionProperty = "opacity";
      highlight.style.width = `${width}px`;
      highlight.style.transform = `translateX(${x}px)`;
      void highlight.offsetWidth; // force the jump to apply before restoring transitions
      highlight.style.transitionProperty = "";
    } else {
      highlight.style.width = `${width}px`;
      highlight.style.transform = `translateX(${x}px)`;
    }

    highlight.classList.add("is-visible");
  }

  function hideHighlight() {
    highlight.classList.remove("is-visible");
  }

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const alreadyActive = item.classList.contains("is-active");
      const wasVisible = highlight.classList.contains("is-visible");

      navItems.forEach((other) => {
        other.classList.remove("is-active");
        other.removeAttribute("aria-current");
      });

      if (!alreadyActive) {
        item.classList.add("is-active");
        item.setAttribute("aria-current", "page");
        moveHighlightTo(item, { instant: !wasVisible });
      } else {
        hideHighlight();
      }
    });
  });

  // Mark whichever nav item matches the current page's album on load --
  // window.ALBUM_SLUG is set inline before this script loads (see
  // index.html / albums/*/index.html), same global infinite-gallery.js
  // reads to know which album's content to fetch.
  if (window.ALBUM_SLUG) {
    const currentItem = nav.querySelector(`[data-nav-key="${window.ALBUM_SLUG}"]`);
    if (currentItem) {
      currentItem.classList.add("is-active");
      currentItem.setAttribute("aria-current", "page");
      moveHighlightTo(currentItem, { instant: true });
    }
  }

  // The rhythm icon just toggles the shared song player -- infinite-gallery.js
  // (a module, loaded separately) owns the actual <audio> element, the fade,
  // and the album's song data (random pick when nothing's been chosen from
  // the list yet), and updates this button's state/aria itself. This script
  // runs before that module does, but the click only happens later, by which
  // point window.songPlayer is set.
  const equalizer = nav.querySelector("[data-equalizer]");
  equalizer?.addEventListener("click", () => {
    window.songPlayer?.toggle();
  });
}

document.querySelectorAll(".navbar").forEach(initNavbar);

const navMobile = document.querySelector("[data-nav-mobile]");
const navBurger = document.querySelector("[data-nav-burger]");
const navMobileMenu = document.querySelector("[data-nav-mobile-menu]");

if (navMobile && navBurger && navMobileMenu) {
  function closeMobileMenu() {
    navBurger.classList.remove("is-open");
    navBurger.setAttribute("aria-expanded", "false");
    navMobileMenu.classList.remove("is-open");
  }

  function openMobileMenu() {
    navBurger.classList.add("is-open");
    navBurger.setAttribute("aria-expanded", "true");
    navMobileMenu.classList.add("is-open");
  }

  navBurger.addEventListener("click", () => {
    if (navBurger.classList.contains("is-open")) {
      closeMobileMenu();
    } else {
      openMobileMenu();
    }
  });

  navMobileMenu.querySelectorAll("[data-mobile-nav-item]").forEach((item) => {
    item.addEventListener("click", closeMobileMenu);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-nav-mobile]")) {
      closeMobileMenu();
    }
  });
}

const bgVideo = document.querySelector("[data-bg-video]");
const maskWindows = document.querySelectorAll(".redact");

function updateVideoMask() {
  if (!bgVideo || maskWindows.length === 0) return;

  const videoRect = bgVideo.getBoundingClientRect();

  const subpaths = Array.from(maskWindows)
    .map((el) => el.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => {
      const x1 = rect.left - videoRect.left;
      const y1 = rect.top - videoRect.top;
      const x2 = rect.right - videoRect.left;
      const y2 = rect.bottom - videoRect.top;
      return `M${x1},${y1} L${x2},${y1} L${x2},${y2} L${x1},${y2} Z`;
    });

  if (subpaths.length === 0) return;

  bgVideo.style.clipPath = `path('${subpaths.join(" ")}')`;
  document.documentElement.classList.add("js-video-ready");
}

let maskRAF = null;
function scheduleMaskUpdate() {
  if (maskRAF) return;
  maskRAF = requestAnimationFrame(() => {
    updateVideoMask();
    maskRAF = null;
  });
}

if (bgVideo) {
  updateVideoMask();
  window.addEventListener("load", updateVideoMask);
  window.addEventListener("resize", scheduleMaskUpdate);
  window.addEventListener("scroll", scheduleMaskUpdate, { passive: true });
  document.fonts?.ready.then(updateVideoMask);
}

const revealTargets = document.querySelectorAll(".lyric-line span:not(.redact)");
const REVEAL_MAX_DELAY = 0.65;
const REVEAL_TRANSITION_MS = 1700;

revealTargets.forEach((el) => {
  el.style.transitionDelay = `${Math.random() * REVEAL_MAX_DELAY}s`;
});

maskWindows.forEach((el) => {
  if (Math.random() < 0.5) el.classList.add("origin-right");
  el.style.transitionDelay = `${Math.random() * REVEAL_MAX_DELAY}s`;
});

function animateMaskReveal() {
  const start = performance.now();
  const totalMs = REVEAL_MAX_DELAY * 1000 + REVEAL_TRANSITION_MS + 100;
  function tick(now) {
    updateVideoMask();
    if (now - start < totalMs) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    revealTargets.forEach((el) => el.classList.add("is-visible"));
    maskWindows.forEach((el) => el.classList.add("is-visible"));
    if (bgVideo) animateMaskReveal();
  });
});

const heroSection = document.querySelector(".hero");
const cursorLabel = document.querySelector("[data-cursor-label]");

if (heroSection && cursorLabel) {
  heroSection.addEventListener("mousemove", (event) => {
    cursorLabel.style.left = `${event.clientX}px`;
    cursorLabel.style.top = `${event.clientY}px`;
  });

  heroSection.addEventListener("mouseenter", () => {
    cursorLabel.classList.add("is-active");
  });

  heroSection.addEventListener("mouseleave", () => {
    cursorLabel.classList.remove("is-active");
  });
}

const newViewportWrapperHero = document.querySelector("[data-new-viewport-wrapper-hero]");
const viewportWrapperHero = document.querySelector("[data-viewport-wrapper-hero]");
const viewportWrapperCms = document.querySelector("[data-viewport-wrapper-cms]");

if (newViewportWrapperHero && viewportWrapperHero && viewportWrapperCms) {
  viewportWrapperHero.addEventListener("click", () => {
    newViewportWrapperHero.classList.add("is-collapsed");
    viewportWrapperCms.classList.remove("is-collapsed");
  });
}
