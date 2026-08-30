// share.js — getting a level from one person to another.
//
// There is no server. The game is a folder of static files, and adding a
// backend to hold user castles would mean accounts, moderation and a bill, for
// a thing that is fundamentally a few hundred bytes of numbers. So a level
// travels the two ways that need nobody's permission:
//
//   * as a LINK — the whole castle deflated and base64'd into the URL fragment,
//     which never leaves the browser and never reaches a server log
//   * as a FILE — the same document as readable JSON, for packs and for keeping
//
// Both directions are lossless and both go through normaliseDef on the way in,
// because a link is a stranger's input.

import { normaliseDef, DEF_VERSION, LIMITS } from './leveldef.js';

const PACK_LIMIT = 24;                 // levels in one pack

// ---- the wire format ------------------------------------------------------

// Keys are shortened on the way out and restored on the way in. It is not
// obfuscation — it is that `{"t":"wall","x":0,"z":-8,...}` repeated ninety
// times is most of the URL, and a link that fits in a chat message gets shared
// while one that wraps over four lines does not.
const SHORT = {
  name: 'n', author: 'a', theme: 'h', orbitR: 'r', masonry: 'm',
  plinth: 'p', loadout: 'l', pieces: 'q', v: 'v',
  t: 't', x: 'x', z: 'z', y: 'y', len: 'L', thick: 'k', courses: 'c',
  axis: 'X', mat: 'M', merlons: 'b', joistAt: 'j', hw: 'w', hd: 'd',
  hx: 'A', hy: 'B', hz: 'C', foe: 'f', dx: 'D', dz: 'E', n: 'N', r: 'r',
  pinY: 'P',
};
const LONG = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));

function shorten(o) {
  if (Array.isArray(o)) return o.map(shorten);
  if (!o || typeof o !== 'object') return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) out[SHORT[k] || k] = shorten(v);
  return out;
}

function lengthen(o) {
  if (Array.isArray(o)) return o.map(lengthen);
  if (!o || typeof o !== 'object') return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) out[LONG[k] || k] = lengthen(v);
  return out;
}

// Numbers come out of the editor with float noise (12.300000000000001). Two
// decimals is finer than anything the game can distinguish and it roughly
// halves the payload.
function round(o) {
  if (Array.isArray(o)) return o.map(round);
  if (typeof o === 'number') return Math.round(o * 100) / 100;
  if (!o || typeof o !== 'object') return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = round(v);
  return out;
}

// ---- base64url ------------------------------------------------------------

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - t.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deflate(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    w.write(bytes); w.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) { return null; }
}

async function inflate(bytes) {
  if (typeof DecompressionStream !== 'function') return null;
  try {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(bytes); w.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) { return null; }
}

// ---- encode / decode ------------------------------------------------------

// A 'd' prefix means deflated, 'r' means raw. Older browsers without
// CompressionStream still produce a working (longer) link rather than nothing,
// and either prefix decodes anywhere.
export async function encode(obj) {
  const json = JSON.stringify(round(shorten(obj)));
  const raw = new TextEncoder().encode(json);
  const z = await deflate(raw);
  return (z && z.length < raw.length) ? 'd' + b64url(z) : 'r' + b64url(raw);
}

export async function decode(code) {
  if (!code || typeof code !== 'string') return null;
  const tag = code[0], body = code.slice(1);
  let bytes;
  try { bytes = unb64url(body); } catch (e) { return null; }
  if (tag === 'd') {
    bytes = await inflate(bytes);
    if (!bytes) return null;
  } else if (tag !== 'r') return null;
  try { return lengthen(JSON.parse(new TextDecoder().decode(bytes))); }
  catch (e) { return null; }
}

// ---- levels ---------------------------------------------------------------

export async function levelLink(def) {
  const code = await encode(def);
  return location.origin + location.pathname + '#c=' + code;
}

export async function packLink(pack) {
  const code = await encode(packDoc(pack));
  return location.origin + location.pathname + '#p=' + code;
}

// What is in the URL right now, if anything. Returns
// { kind:'level'|'pack', def|pack } or null.
export async function readHash() {
  const h = (location.hash || '').replace(/^#/, '');
  if (!h) return null;
  const m = /(?:^|&)([cp])=([A-Za-z0-9\-_]+)/.exec(h);
  if (!m) return null;
  const obj = await decode(m[2]);
  if (!obj) return null;
  if (m[1] === 'c') return { kind: 'level', def: normaliseDef(obj) };
  return { kind: 'pack', pack: normalisePack(obj) };
}

export function clearHash() {
  try { history.replaceState(null, '', location.pathname + location.search); }
  catch (e) { location.hash = ''; }
}

// ---- packs ----------------------------------------------------------------

export function blankPack(name = 'My pack') {
  return { v: DEF_VERSION, name, author: '', levels: [] };
}

function packDoc(p) {
  return { v: DEF_VERSION, name: p.name, author: p.author || '', levels: p.levels };
}

export function normalisePack(raw) {
  const p = blankPack();
  if (!raw || typeof raw !== 'object') return p;
  p.name = String(raw.name || p.name).slice(0, LIMITS.nameLen);
  p.author = String(raw.author || '').slice(0, LIMITS.authorLen);
  const list = Array.isArray(raw.levels) ? raw.levels.slice(0, PACK_LIMIT) : [];
  p.levels = list.map(normaliseDef);
  return p;
}

// ---- files ----------------------------------------------------------------

// Readable JSON on purpose. A .onager file that opens in a text editor is a
// file someone can look at before they run it, and can hand-edit if they want
// to. The link format is the compact one; the file format is the honest one.
export function download(obj, filename) {
  const json = JSON.stringify(obj, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile() {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,.onager,application/json';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) return res(null);
      // A castle is a few kilobytes. Anything much bigger is not one.
      if (f.size > 512 * 1024) return res({ error: 'That file is too large to be a castle.' });
      const r = new FileReader();
      r.onload = () => {
        try { res({ obj: JSON.parse(String(r.result)) }); }
        catch (e) { res({ error: 'That file is not a castle this game can read.' }); }
      };
      r.onerror = () => res({ error: 'Could not read that file.' });
      r.readAsText(f);
    });
    inp.click();
  });
}

export function safeName(s) {
  return (String(s || 'castle').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'castle');
}

// ---- local storage --------------------------------------------------------

const KEY = 'onager_workshop_v1';

export function loadWorkshop() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { levels: [], packs: [] };
    const o = JSON.parse(raw);
    return {
      levels: (Array.isArray(o.levels) ? o.levels : []).slice(0, 80).map(normaliseDef),
      packs: (Array.isArray(o.packs) ? o.packs : []).slice(0, 24).map(normalisePack),
    };
  } catch (e) { return { levels: [], packs: [] }; }
}

export function saveWorkshop(w) {
  try { localStorage.setItem(KEY, JSON.stringify(w)); return true; }
  catch (e) { return false; }        // private mode, or the quota is full
}
