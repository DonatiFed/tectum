import * as THREE from 'three';

/**
 * Auto-detect "up" axis by face-area dominance.
 * Samples up to N triangles, sums face area projected onto each ±axis,
 * picks the positive direction with the largest sum. Returns a quaternion
 * that maps that direction to +Y.
 */
export function detectUpQuaternion(object3d, sampleLimit = 80000) {
  const sums = { px: 0, nx: 0, py: 0, ny: 0, pz: 0, nz: 0 };
  object3d.updateWorldMatrix(true, true);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let sampled = 0;

  object3d.traverse((o) => {
    if (!o.isMesh || !o.geometry || sampled >= sampleLimit) return;
    const geo = o.geometry;
    const pos = geo.attributes.position;
    if (!pos) return;
    const idx = geo.index;
    const tri = idx ? idx.count / 3 : pos.count / 3;
    const matWorld = o.matrixWorld;
    const stride = Math.max(1, Math.floor(tri / 4000));

    for (let f = 0; f < tri; f += stride) {
      const i0 = idx ? idx.array[f * 3]     : f * 3;
      const i1 = idx ? idx.array[f * 3 + 1] : f * 3 + 1;
      const i2 = idx ? idx.array[f * 3 + 2] : f * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(matWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(matWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(matWorld);
      const e1 = b.clone().sub(a);
      const e2 = c.clone().sub(a);
      const n = e1.cross(e2);
      const area = n.length() * 0.5;
      if (area < 1e-8) continue;
      n.normalize();

      // Only count near-axis-aligned faces (typical of architectural geometry)
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      const maxC = Math.max(ax, ay, az);
      if (maxC < 0.6) continue;

      if (ax === maxC)      sums[n.x > 0 ? 'px' : 'nx'] += area;
      else if (ay === maxC) sums[n.y > 0 ? 'py' : 'ny'] += area;
      else                  sums[n.z > 0 ? 'pz' : 'nz'] += area;
      sampled++;
    }
  });

  // Determine the dominant axis (sum of both directions) and which sign points "up"
  const candidates = {
    py: sums.py,
    ny: sums.ny,
    px: sums.px,
    nx: sums.nx,
    pz: sums.pz,
    nz: sums.nz,
  };
  let bestKey = 'py', bestVal = -1;
  for (const k in candidates) if (candidates[k] > bestVal) { bestVal = candidates[k]; bestKey = k; }

  const dirMap = {
    px: new THREE.Vector3( 1, 0, 0),
    nx: new THREE.Vector3(-1, 0, 0),
    py: new THREE.Vector3( 0, 1, 0),
    ny: new THREE.Vector3( 0,-1, 0),
    pz: new THREE.Vector3( 0, 0, 1),
    nz: new THREE.Vector3( 0, 0,-1),
  };
  const upVec = dirMap[bestKey];
  const targetUp = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(upVec, targetUp);

  return { quat, sums, dominant: bestKey };
}

/**
 * Build cached upward-facing triangles in WORLD space, ready for fast roof
 * detection (no need to walk the scene graph for every click).
 */
export function buildUpwardTriangles(object3d, normalThreshold = 0.10) {
  const tris = [];
  object3d.updateWorldMatrix(true, true);

  object3d.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const geo = o.geometry;
    const pos = geo.attributes.position;
    if (!pos) return;
    const idx = geo.index;
    const tri = idx ? idx.count / 3 : pos.count / 3;
    const matWorld = o.matrixWorld;

    for (let f = 0; f < tri; f++) {
      const i0 = idx ? idx.array[f * 3]     : f * 3;
      const i1 = idx ? idx.array[f * 3 + 1] : f * 3 + 1;
      const i2 = idx ? idx.array[f * 3 + 2] : f * 3 + 2;
      const a = new THREE.Vector3().fromBufferAttribute(pos, i0).applyMatrix4(matWorld);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i1).applyMatrix4(matWorld);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i2).applyMatrix4(matWorld);
      const e1 = b.clone().sub(a);
      const e2 = c.clone().sub(a);
      const n = e1.cross(e2);
      const len = n.length();
      if (len < 1e-9) continue;
      n.divideScalar(len);
      if (n.y < normalThreshold) continue;

      tris.push({
        a, b, c, n,
        cx: (a.x + b.x + c.x) / 3,
        cy: (a.y + b.y + c.y) / 3,
        cz: (a.z + b.z + c.z) / 3,
        area: len * 0.5,
      });
    }
  });

  return tris;
}
