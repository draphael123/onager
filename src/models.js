// models.js — the KayKit character meshes.
//
// KayKit "Adventurers" 2.0, by Kay Lousberg, CC0. See CREDITS.md.
//
// Everything else in this game is generated at runtime, and these are the one
// exception: hand-built characters are the thing procedural geometry was worst
// at, and a knight is the thing you look at most.
//
// Two rules this module exists to enforce:
//
//   * Skinned meshes CANNOT be cloned with object.clone() — the copy shares the
//     original's skeleton and every instance snaps to the same pose. Cloning
//     goes through SkeletonUtils.clone().
//   * Loading is OPTIONAL. If the files are missing or slow, callers fall back
//     to the procedural rigs, because a game that will not start is worse than
//     one that looks plainer.

import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { clone as skinnedClone } from '../vendor/SkeletonUtils.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

const BASE = 'assets/models/';

export const MODELS = {
  ready: false,
  knight: null,        // GLTF scene for our knights
  foe: null,           // GLTF scene for the garrison
  clips: {},           // name -> AnimationClip, shared across the Rig_Medium rig
};

function load(loader, file) {
  return new Promise((res) => {
    loader.load(BASE + file, res, undefined, () => res(null));
  });
}

export async function loadModels() {
  try {
    const loader = new GLTFLoader();
    const [knight, foe, general, movement] = await Promise.all([
      load(loader, 'Knight.glb'),
      load(loader, 'Barbarian.glb'),
      load(loader, 'Anims_General.glb'),
      load(loader, 'Anims_Movement.glb'),
    ]);
    if (!knight) return false;

    MODELS.knight = knight.scene;
    MODELS.foe = (foe && foe.scene) || knight.scene;

    // The animation packs share one rig with the characters, so their clips
    // retarget for free — that is the whole point of KayKit's Rig_Medium.
    for (const src of [knight, foe, general, movement]) {
      if (!src) continue;
      for (const c of src.animations || []) {
        if (!MODELS.clips[c.name]) MODELS.clips[c.name] = c;
      }
    }

    for (const s of [MODELS.knight, MODELS.foe]) {
      s.traverse(o => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          // The atlas is authored in sRGB; unflagged it renders washed out.
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m && m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          }
        }
      });
    }
    mergeCharacter(MODELS.knight, /* keepSeparate */ /cape/i);
    mergeCharacter(MODELS.foe, null);

    MODELS.ready = true;
    return true;
  } catch (e) {
    console.warn('ONAGER: character models unavailable, using procedural rigs', e);
    return false;
  }
}

// KayKit ships a character as one SkinnedMesh per body part — nine for the
// knight, seven for the barbarian — and every one of them is a draw call, twice
// over once shadows are on. A field of them cost 1243 draws and 8ms a frame.
//
// They all share one skeleton and one material, so they can be merged. The only
// part that must stay separate is the cape, because that is what carries each
// knight's colours; `keepSeparate` is a regex naming the meshes to spare.
//
// Geometries are baked through each mesh's own matrix first: they are siblings
// under the armature, and merging without that would collapse any part whose
// transform is not identity onto the origin.
function mergeCharacter(root, keepSeparate) {
  const groups = new Map();          // key -> { geos, mesh }
  const doomed = [];
  root.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const key = keepSeparate && keepSeparate.test(o.name) ? o.name : '__body';
    if (!groups.has(key)) groups.set(key, { geos: [], first: o });
    const g = o.geometry.clone();
    o.updateMatrix();
    if (!o.matrix.equals(IDENTITY)) g.applyMatrix4(o.matrix);
    groups.get(key).geos.push(g);
    doomed.push(o);
  });
  if (!groups.size) return;

  const made = [];
  for (const [key, grp] of groups) {
    if (grp.geos.length === 1) {
      // Nothing to merge; keep the original mesh as it is.
      const keep = grp.first;
      keep.userData.mergedKey = key;
      made.push(keep);
      const i = doomed.indexOf(keep);
      if (i >= 0) doomed.splice(i, 1);
      continue;
    }
    let merged = null;
    try { merged = mergeGeometries(grp.geos, false); } catch (e) { merged = null; }
    if (!merged) {                    // a mismatch means we leave it unmerged
      for (const g of grp.geos) g.dispose();
      return;
    }
    const src = grp.first;
    const m = new THREE.SkinnedMesh(merged, src.material);
    m.name = src.name + '_merged';
    m.userData.mergedKey = key;
    m.castShadow = true; m.receiveShadow = true;
    m.bind(src.skeleton, src.bindMatrix);
    src.parent.add(m);
    made.push(m);
  }
  for (const o of doomed) {
    if (o.parent) o.parent.remove(o);
    o.geometry.dispose();
  }
}

const IDENTITY = new THREE.Matrix4();

// A fresh, independently-posable copy.
//
// `capeTint` recolours ONLY the cape, which is why per-knight identity survives
// the switch to a bought mesh: KayKit gives the cape its own SkinnedMesh, so a
// knight can wear his own colours and still be the same man underneath. All the
// meshes share one material, so it has to be cloned for the one being tinted or
// every knight in the company changes colour together.
//
// `bodyTint` recolours everything, which is what the garrison wants — they need
// to read as hot red targets from thirty metres.
export function spawnCharacter(which, { capeTint, bodyTint } = {}) {
  const src = which === 'foe' ? MODELS.foe : MODELS.knight;
  if (!src) return null;
  const g = skinnedClone(src);
  if (capeTint || bodyTint) {
    g.traverse(o => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      const isCape = /cape/i.test(o.name) || /cape/i.test(o.userData.mergedKey || '');
      const tint = bodyTint || (isCape ? capeTint : null);
      if (!tint) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map(m => {
        if (!m) return m;
        const c = m.clone();
        c.color = new THREE.Color(tint);
        // The material's colour MULTIPLIES the texture, and the atlas is
        // mid-toned, so a tint applied over it came out muddy — every cape read
        // as the same near-black. The cape is a flat region of the atlas
        // anyway, so it loses nothing by dropping the map and showing the
        // colour pure. A whole-body tint keeps its map: the garrison needs the
        // armour detail, it just needs it red.
        if (!bodyTint) c.map = null;
        return c;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
  }
  return g;
}

// Height of the source mesh, so callers can scale to the size the physics
// expects rather than guessing.
export const MODEL_HEIGHT = 2.54;

export function listClips() {
  return Object.keys(MODELS.clips);
}
