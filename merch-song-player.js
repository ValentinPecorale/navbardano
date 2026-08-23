import { createClient } from "@sanity/client";
import { getSongAudioEl, setEqualizerPlaying, startSongAudio, pauseSongAudio } from "./song-player.js";

// Song player for any page with no single "current album" (right now just
// /merch -- add the same <script type="module" src="/merch-song-player.js">
// tag to any future non-album page that should get this too). Album pages
// get their own equivalent wiring in infinite-gallery.js, picking randomly
// from just that album's songs; this fetches every album's songs once and
// picks one at random from all of them combined. Shares the nav's single
// <audio> element and the fade/equalizer-state mechanics with the
// album-page player via song-player.js -- never two players fighting over
// the audio.
const sanity = createClient({
  projectId: "9q5qedja",
  dataset: "production",
  apiVersion: "2024-01-01",
  useCdn: true,
});

let currentSong = null;

// When the random pick finishes, drop back to "nothing chosen" so the next
// equalizer click picks a fresh random song rather than silently replaying
// the same one from the end (mirrors renderSongCollection's onended in
// infinite-gallery.js).
const audioEl = getSongAudioEl();
if (audioEl) {
  audioEl.onended = () => {
    setEqualizerPlaying(false);
    currentSong = null;
    audioEl.currentTime = 0;
  };
}

async function fetchRandomSong() {
  try {
    const docs = await sanity.fetch(`*[_type == "album"]{ "songs": songs[]{ title, "audioUrl": audio.asset->url } }`);
    const playable = (docs ?? []).flatMap((doc) => doc.songs ?? []).filter((song) => song.audioUrl);
    if (!playable.length) return null;
    return playable[Math.floor(Math.random() * playable.length)];
  } catch (err) {
    console.error("[merch-song-player] Failed to fetch songs from Sanity.", err);
    return null;
  }
}

async function toggle() {
  const audio = getSongAudioEl();
  if (!audio) return;

  if (!audio.paused) {
    pauseSongAudio(audio);
    return;
  }

  if (!currentSong) {
    currentSong = await fetchRandomSong();
    if (!currentSong) return;
    audio.src = currentSong.audioUrl;
    audio.currentTime = 0;
  }

  startSongAudio(audio);
}

if (!window.songPlayer) {
  window.songPlayer = { toggle };
}
