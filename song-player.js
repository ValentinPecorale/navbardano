// Shared song-player primitives -- there's only ever one <audio> element on
// the whole site (the nav's own [data-equalizer-audio], duplicated markup
// but never more than one page loaded at a time), so this module's fade
// state is safely module-level singleton state, same as it was when this
// lived inline in infinite-gallery.js.
//
// This module only owns *how* a song plays (fade in/out, the equalizer
// icon's playing state). It has no opinion on *which* songs are available
// or which one is current -- that's each consumer's own job:
//   - infinite-gallery.js (album pages): the current album's song list,
//     row highlighting, click-a-row-to-pick-that-song.
//   - merch-song-player.js (any non-album page): one song picked at
//     random from every album's list, no row UI to highlight.
// Both wire the result into window.songPlayer.toggle() for the nav's
// rhythm icon (script.js) to call.

let fadeRAF = null;

export function getSongAudioEl() {
  return document.querySelector("[data-equalizer-audio]");
}

export function fadeSongAudio(audio, targetVolume, duration, onComplete) {
  cancelAnimationFrame(fadeRAF);
  const startVolume = audio.volume;
  const startTime = performance.now();
  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    audio.volume = startVolume + (targetVolume - startVolume) * t;
    if (t < 1) {
      fadeRAF = requestAnimationFrame(step);
    } else {
      onComplete?.();
    }
  }
  fadeRAF = requestAnimationFrame(step);
}

export const SONG_FADE_MS = 600;

export function setEqualizerPlaying(isPlaying) {
  const equalizer = document.querySelector("[data-equalizer]");
  if (!equalizer) return;
  equalizer.classList.toggle("is-playing", isPlaying);
  equalizer.setAttribute("aria-pressed", String(isPlaying));
  equalizer.setAttribute(
    "aria-label",
    isPlaying ? "Pausar reproductor de música" : "Reproducir reproductor de música"
  );
}

export function startSongAudio(audio) {
  audio.volume = 0;
  audio.play();
  fadeSongAudio(audio, 1, SONG_FADE_MS);
  setEqualizerPlaying(true);
}

export function pauseSongAudio(audio) {
  fadeSongAudio(audio, 0, SONG_FADE_MS, () => {
    audio.pause();
    audio.volume = 1;
  });
  setEqualizerPlaying(false);
}
