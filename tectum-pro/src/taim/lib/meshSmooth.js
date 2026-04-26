import * as THREE from 'three';

// ─── Cache of original (un-smoothed) BufferAttribute arrays per geometry.
// Keyed by geometry.uuid so toggling smoothing is fully reversible.
const ORIG = new Map();

// Spatial hash precision: vertices within ~1 mm in world space are considered
// the same shared vertex. Tweaks here trade welding aggressiveness vs. speed.
const WELD_PRECISION = 1000; // → round to nearest 0.001 world unit

function rememberOriginal(mesh) {
  const geo = mesh.geometry;
  if (!geo || ORIG.has(geo.uuid)) return;
  const pos = geo.attributes.position;
  if (!pos) return;
  // Store positions in WORLD space so welding works across meshes regardless
  // of their parent transforms.
  mesh.updateWorldMatrix(true, false);
  const matWorld = mesh.matrixWorld;
  const wp = new Float32Array(pos.array.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matWorld);
    wp[i*3] = v.x; wp[i*3+1] = v.y; wp[i*3+2] = v.z;
  }
  ORIG.set(geo.uuid, { local: new Float32Array(pos.array), world: wp });
}

/** Restore original vertex positions for every cached mesh. */
export function resetMeshSmoothing(meshes) {
  for (const m of meshes) {
    const geo = m.geometry;
    if (!geo) continue;
    const orig = ORIG.get(geo.uuid);
    if (!orig) continue;
    geo.attributes.position.array.set(orig.local);
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
}

/** Flatten high-frequency bumps without splitting seams between sub-meshes.
 *
 *  Strategy:
 *    1. Weld coincident vertices across ALL meshes by hashing world-space
 *       positions. Every welded group shares one logical "super-vertex".
 *    2. Build adjacency on these super-vertices (so an edge that crosses
 *       two sub-meshes is treated as a single edge).
 *    3. Run Taubin λ/μ smoothing on super-vertices. The per-vertex delta
 *       is projected onto the original surface normal so motion is purely
 *       perpendicular to the surface — preserves silhouette and prevents
 *       lateral drift.
 *    4. Write the same new position back to every original vertex in each
 *       welded group → seams stay perfectly aligned, no gaps appear.
 *
 *  `strength` is 0..1: 0 = original; 1 = maximum flattening.
 */
export function smoothMeshes(meshes, strength = 0) {
  const s = Math.max(0, Math.min(1, strength));
  if (s <= 0.001) { resetMeshSmoothing(meshes); return; }

  // Map slider 0..1 → up to 10 iterations and λ in [0.2 .. 0.8]
  const iterations = Math.max(1, Math.round(s * 10));
  const LAMBDA =  0.2 + s * 0.6;
  const MU     = -(LAMBDA + 0.03);  // slight over-relaxation cancels shrinkage

  // Cache originals (in world space) for every mesh
  for (const m of meshes) rememberOriginal(m);

  // 1. Build global super-vertex table by hashing world positions.
  //    For every (mesh, localIndex) we record the super-vertex id it maps to.
  const meshInfo = []; // [{ mesh, geo, vN, localToSuper: Int32Array, invWorld: Matrix4 }]
  const posKey = new Map();    // "x|y|z" → super id
  const superPos = [];         // Float64 [x, y, z, ...]
  let superCount = 0;

  for (const mesh of meshes) {
    const geo = mesh.geometry;
    if (!geo) continue;
    const pos = geo.attributes.position;
    const idx = geo.index;
    if (!pos || !idx) continue;
    const orig = ORIG.get(geo.uuid);
    if (!orig) continue;
    const vN = pos.count;
    const map = new Int32Array(vN);
    for (let i = 0; i < vN; i++) {
      const wx = orig.world[i*3], wy = orig.world[i*3+1], wz = orig.world[i*3+2];
      const kx = Math.round(wx * WELD_PRECISION);
      const ky = Math.round(wy * WELD_PRECISION);
      const kz = Math.round(wz * WELD_PRECISION);
      const key = kx + '|' + ky + '|' + kz;
      let id = posKey.get(key);
      if (id === undefined) {
        id = superCount++;
        posKey.set(key, id);
        superPos.push(wx, wy, wz);
      }
      map[i] = id;
    }
    const invWorld = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    meshInfo.push({ mesh, geo, vN, localToSuper: map, invWorld });
  }
  if (!superCount) return;

  // 2. Build adjacency on super-vertices using the index buffer of each mesh.
  const adj = new Array(superCount);
  for (let i = 0; i < superCount; i++) adj[i] = new Set();
  for (const info of meshInfo) {
    const ia = info.geo.index.array;
    const map = info.localToSuper;
    for (let f = 0; f < ia.length; f += 3) {
      const a = map[ia[f]], b = map[ia[f+1]], c = map[ia[f+2]];
      if (a !== b) { adj[a].add(b); adj[b].add(a); }
      if (b !== c) { adj[b].add(c); adj[c].add(b); }
      if (c !== a) { adj[c].add(a); adj[a].add(c); }
    }
  }

  // 3. Compute super-vertex normals from the *original* surface (averaged
  //    face normals weighted by face area). Frozen for the duration so
  //    motion stays purely along the surface normal.
  const normals = new Float32Array(superCount * 3);
  {
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    for (const info of meshInfo) {
      const ia = info.geo.index.array;
      const map = info.localToSuper;
      const w = ORIG.get(info.geo.uuid).world;
      for (let f = 0; f < ia.length; f += 3) {
        const ai = ia[f], bi = ia[f+1], ci = ia[f+2];
        va.set(w[ai*3], w[ai*3+1], w[ai*3+2]);
        vb.set(w[bi*3], w[bi*3+1], w[bi*3+2]);
        vc.set(w[ci*3], w[ci*3+1], w[ci*3+2]);
        e1.subVectors(vb, va);
        e2.subVectors(vc, va);
        n.crossVectors(e1, e2); // length = 2 × area, direction = face normal
        const a = map[ai] * 3, b = map[bi] * 3, c = map[ci] * 3;
        normals[a]   += n.x; normals[a+1] += n.y; normals[a+2] += n.z;
        normals[b]   += n.x; normals[b+1] += n.y; normals[b+2] += n.z;
        normals[c]   += n.x; normals[c+1] += n.y; normals[c+2] += n.z;
      }
    }
    for (let i = 0; i < superCount; i++) {
      const x = normals[i*3], y = normals[i*3+1], z = normals[i*3+2];
      const len = Math.hypot(x, y, z);
      if (len > 1e-9) {
        normals[i*3] = x/len; normals[i*3+1] = y/len; normals[i*3+2] = z/len;
      }
    }
  }

  // 4. Taubin smoothing on super-vertices, motion projected onto normal.
  const buf = new Float64Array(superPos);   // mutable working buffer
  const tmp = new Float64Array(buf.length);
  const applyPass = (factor) => {
    for (let v = 0; v < superCount; v++) {
      const ns = adj[v];
      const x = buf[v*3], y = buf[v*3+1], z = buf[v*3+2];
      if (!ns.size) {
        tmp[v*3] = x; tmp[v*3+1] = y; tmp[v*3+2] = z;
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      for (const k of ns) { sx += buf[k*3]; sy += buf[k*3+1]; sz += buf[k*3+2]; }
      const inv = 1 / ns.size;
      const dx = sx * inv - x;
      const dy = sy * inv - y;
      const dz = sz * inv - z;
      const nx = normals[v*3], ny = normals[v*3+1], nz = normals[v*3+2];
      const t = dx * nx + dy * ny + dz * nz;
      tmp[v*3]   = x + factor * t * nx;
      tmp[v*3+1] = y + factor * t * ny;
      tmp[v*3+2] = z + factor * t * nz;
    }
    buf.set(tmp);
  };
  for (let it = 0; it < iterations; it++) {
    applyPass(LAMBDA);
    applyPass(MU);
  }

  // 5. Write the new positions back into each mesh's local space. Every
  //    original vertex in a welded group receives the same world position,
  //    so seams across meshes stay sealed.
  const tmpV = new THREE.Vector3();
  for (const info of meshInfo) {
    const pos = info.geo.attributes.position;
    const map = info.localToSuper;
    for (let i = 0; i < info.vN; i++) {
      const sid = map[i];
      tmpV.set(buf[sid*3], buf[sid*3+1], buf[sid*3+2]).applyMatrix4(info.invWorld);
      pos.array[i*3]   = tmpV.x;
      pos.array[i*3+1] = tmpV.y;
      pos.array[i*3+2] = tmpV.z;
    }
    pos.needsUpdate = true;
    info.geo.computeVertexNormals();
    info.geo.computeBoundingBox();
    info.geo.computeBoundingSphere();
  }
}
