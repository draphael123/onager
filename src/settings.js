// settings.js — one live object, persisted, applied to the renderer.
//
// `quality` is the important one. The scene is ~370 rigid bodies plus a few
// hundred scatter props, which a laptop eats happily and a phone does not.
// Quality is auto-detected once and then owned by the player.

const KEY = 'onager_settings_v1';

export const SET = {
  volume: 0.7,
  quality: 'auto',        // auto | low | medium | high
  shadows: true,
  shake: true,
  haptics: true,
  showArc: true,
  showMarkers: true,
  leftHanded: false,
  reduceMotion: false,
  knights: 9,
};

export const QUALITY = {
  low:    { pixelRatio: 1.0, shadowMap: 1024, softShadows: false, scatter: 46,  debris: 46,  clouds: 5,  hills: 0.45 },
  medium: { pixelRatio: 1.4, shadowMap: 1536, softShadows: true,  scatter: 95,  debris: 84,  clouds: 8,  hills: 0.75 },
  high:   { pixelRatio: 2.0, shadowMap: 2048, softShadows: true,  scatter: 150, debris: 130, clouds: 11, hills: 1.0 },
};

// One guess, made once, that the player can override. Deliberately
// conservative: a phone that runs at 60fps on "low" is a better first
// impression than a slideshow on "high".
export function detectQuality() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 780;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (coarse || small) return (cores >= 8 && mem >= 6) ? 'medium' : 'low';
  if (cores <= 4 || mem <= 4) return 'medium';
  return 'high';
}

export function activeQuality() {
  const q = SET.quality === 'auto' ? detectQuality() : SET.quality;
  return QUALITY[q] || QUALITY.medium;
}

export function activeQualityName() {
  return SET.quality === 'auto' ? detectQuality() : SET.quality;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(SET, JSON.parse(raw));
  } catch (e) { /* private mode, cleared storage — defaults are fine */ }
  return SET;
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(SET)); } catch (e) { /* ignore */ }
}

// Everything that can change at runtime without rebuilding the scene.
export function applySettings(rd, sfx) {
  if (sfx && sfx.master) sfx.master.gain.value = SET.volume * 0.7;
  if (!rd) return;
  const q = activeQuality();
  rd.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
  rd.renderer.shadowMap.enabled = SET.shadows;
  if (rd.sun) {
    rd.sun.castShadow = SET.shadows;
    if (rd.sun.shadow.mapSize.width !== q.shadowMap) {
      rd.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      if (rd.sun.shadow.map) { rd.sun.shadow.map.dispose(); rd.sun.shadow.map = null; }
    }
  }
  rd.renderer.shadowMap.needsUpdate = true;
  rd.resize();
}
