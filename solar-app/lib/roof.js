import * as THREE from 'three';

const NORMAL_TOL_DEG = 10;     // for connectivity (tighter)
const HEIGHT_TOL_M   = 1.0;    // for connectivity (tighter)
const NEIGHBOR_DIST  = 1.6;    // metres — gap that breaks the chain (tighter)
const BUCKET         = 2.0;    // spatial-hash bucket size

const ANGLE_TOL_FIT  = Math.cos(THREE.MathUtils.degToRad(20));
const PLANE_DIST_TOL = 0.5;
const REFINE_DIST_TOL = 0.35; // 2nd-pass: after we know the plane, only keep tris within 35cm
const MIN_INLIERS    = 6;
const MIN_AREA_M2    = 4;

const MASK_CELL = 0.20;        // raster resolution (m) for clean masks
const MASK_PAD  = 0.6;         // metres padded around bbox

// ──────────────────────────────────────────────────────────────────────────
// Spatial hash for upward-triangle index (built once per detection call).
// ──────────────────────────────────────────────────────────────────────────
function buildHash(triangles, predicate = null) {
  const map = new Map();
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    if (predicate && !predicate(t)) continue;
    const kx = Math.floor(t.cx / BUCKET);
    const kz = Math.floor(t.cz / BUCKET);
    const key = kx + ',' + kz;
    let arr = map.get(key);
    if (!arr) { arr = []; map.set(key, arr); }
    arr.push(i);
  }
  return map;
}

function bucketKey(x, z) {
  return Math.floor(x / BUCKET) + ',' + Math.floor(z / BUCKET);
}

// Walk neighbours of `start` index; predicate decides which adjacent triangles
// are part of the same continuous roof patch.
function floodFill(triangles, hash, startIdx, visited, options = {}) {
  const normalTol = Math.cos(THREE.MathUtils.degToRad(options.normalTolDeg ?? NORMAL_TOL_DEG));
  const heightTol = options.heightTol ?? HEIGHT_TOL_M;
  const distSq    = (options.neighborDist ?? NEIGHBOR_DIST) ** 2;

  const cluster = [];
  const queue = [startIdx];
  visited.add(startIdx);
  const seedNormal = triangles[startIdx].n;

  while (queue.length) {
    const idx = queue.pop();
    const t = triangles[idx];
    cluster.push(t);

    const kx = Math.floor(t.cx / BUCKET);
    const kz = Math.floor(t.cz / BUCKET);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = hash.get((kx + dx) + ',' + (kz + dz));
        if (!arr) continue;
        for (const j of arr) {
          if (visited.has(j)) continue;
          const u = triangles[j];
          // Connectivity: spatial gap small, similar normal to seed (so
          // we don't drift across multiple slopes), similar height to local.
          const ddx = u.cx - t.cx, ddz = u.cz - t.cz, ddy = u.cy - t.cy;
          if (ddx * ddx + ddz * ddz > distSq) continue;
          if (Math.abs(ddy) > heightTol) continue;
          if (u.n.dot(seedNormal) < normalTol) continue;
          visited.add(j);
          queue.push(j);
        }
      }
    }
  }
  return cluster;
}

// ──────────────────────────────────────────────────────────────────────────
// Plane fit (area-weighted average + inlier refinement + 2-D PCA).
// ──────────────────────────────────────────────────────────────────────────
function fitPlane(candidates) {
  if (!candidates || candidates.length < 3) {
    return { ok: false, reason: `only ${candidates?.length ?? 0} triangles in cluster` };
  }

  // 1. Area-weighted plane
  let nx = 0, ny = 0, nz = 0, totalA = 0, cx = 0, cy = 0, cz = 0;
  for (const t of candidates) {
    nx += t.n.x * t.area; ny += t.n.y * t.area; nz += t.n.z * t.area;
    cx += t.cx  * t.area; cy += t.cy  * t.area; cz += t.cz  * t.area;
    totalA += t.area;
  }
  const avgN = new THREE.Vector3(nx, ny, nz).normalize();
  const avgC = new THREE.Vector3(cx / totalA, cy / totalA, cz / totalA);

  // 2. Inlier refinement (loose pass — locks the plane direction)
  const planeD = -avgN.dot(avgC);
  let inliers = candidates.filter((t) => {
    const pt = new THREE.Vector3(t.cx, t.cy, t.cz);
    return Math.abs(avgN.dot(pt) + planeD) < PLANE_DIST_TOL && t.n.dot(avgN) > ANGLE_TOL_FIT;
  });
  if (inliers.length < MIN_INLIERS) {
    return { ok: false, reason: `inliers=${inliers.length} (plane fit failed)` };
  }

  // 2b. Re-fit on the inliers, then second-pass refinement with a TIGHTER
  // distance tolerance. Drops triangles that drifted onto an adjacent slope.
  let nx2 = 0, ny2 = 0, nz2 = 0, totA2 = 0, ccx = 0, ccy = 0, ccz = 0;
  for (const t of inliers) {
    nx2 += t.n.x * t.area; ny2 += t.n.y * t.area; nz2 += t.n.z * t.area;
    ccx += t.cx  * t.area; ccy += t.cy  * t.area; ccz += t.cz  * t.area;
    totA2 += t.area;
  }
  const refN = new THREE.Vector3(nx2, ny2, nz2).normalize();
  const refC = new THREE.Vector3(ccx / totA2, ccy / totA2, ccz / totA2);
  const refD = -refN.dot(refC);
  inliers = inliers.filter((t) => {
    const d = Math.abs(refN.x * t.cx + refN.y * t.cy + refN.z * t.cz + refD);
    return d < REFINE_DIST_TOL && t.n.dot(refN) > ANGLE_TOL_FIT;
  });
  if (inliers.length < MIN_INLIERS) {
    return { ok: false, reason: `refined-inliers=${inliers.length}` };
  }
  // Use the refined fit going forward
  avgN.copy(refN);
  avgC.copy(refC);

  // 3. PCA to find principal in-plane axes
  const worldUp = new THREE.Vector3(0, 1, 0);
  let u = new THREE.Vector3().crossVectors(worldUp, avgN);
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
  u.normalize();
  let v = new THREE.Vector3().crossVectors(avgN, u).normalize();

  const pts2 = [];
  for (const t of inliers) {
    for (const p of [t.a, t.b, t.c]) {
      const d = p.clone().sub(avgC);
      pts2.push([d.dot(u), d.dot(v)]);
    }
  }
  let mx = 0, my = 0;
  pts2.forEach((p) => { mx += p[0]; my += p[1]; });
  mx /= pts2.length; my /= pts2.length;
  let cxx = 0, cxy = 0, cyy = 0;
  pts2.forEach((p) => {
    const dx = p[0] - mx, dy = p[1] - my;
    cxx += dx * dx; cxy += dx * dy; cyy += dy * dy;
  });
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const u2 = u.clone().multiplyScalar(cosT).addScaledVector(v,  sinT).normalize();
  const v2 = u.clone().multiplyScalar(-sinT).addScaledVector(v, cosT).normalize();

  let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
  for (const t of inliers) {
    for (const p of [t.a, t.b, t.c]) {
      const d = p.clone().sub(avgC);
      const lx = d.dot(u2), ly = d.dot(v2);
      if (lx < pMinX) pMinX = lx;
      if (lx > pMaxX) pMaxX = lx;
      if (ly < pMinY) pMinY = ly;
      if (ly > pMaxY) pMaxY = ly;
    }
  }

  const width  = pMaxX - pMinX;
  const height = pMaxY - pMinY;
  if (width * height < MIN_AREA_M2) {
    return { ok: false, reason: `plane too small (${width.toFixed(1)}×${height.toFixed(1)})` };
  }

  const centre = avgC.clone()
    .addScaledVector(u2, (pMinX + pMaxX) / 2)
    .addScaledVector(v2, (pMinY + pMaxY) / 2);

  const tiltDeg = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(-1, avgN.y))));
  const azimuth = THREE.MathUtils.radToDeg(Math.atan2(u2.x, u2.z));

  // 4. Rasterize the cluster into a binary mask (in plane-local frame relative
  // to `centre`), morphologically clean, then trace its boundary into a
  // smooth polygon. This is far more robust than walking triangle edges
  // because it handles non-manifold meshes, T-junctions and overlaps.
  const grid = buildRaster(inliers, avgC, u2, v2, centre, width, height);
  const mask = extractPolygon(grid);

  return {
    ok: true,
    plane: {
      normal: avgN, u: u2, v: v2,
      centre, width, height,
      area: width * height,
      tilt: tiltDeg, azimuth,
      inlierCount: inliers.length,
      mask,
      grid,                     // mutable raster + metadata for live erase
      gridOriginal: cloneGrid(grid),
      cutOps: 0,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Raster mask: triangle scan-conversion + morph-close + boundary tracing
// ──────────────────────────────────────────────────────────────────────────
function buildRaster(triangles, planeOrigin, axisU, axisV, centre, width, height) {
  const offsetU = centre.clone().sub(planeOrigin).dot(axisU);
  const offsetV = centre.clone().sub(planeOrigin).dot(axisV);
  const project = (p) => {
    const d = p.clone().sub(planeOrigin);
    return [d.dot(axisU) - offsetU, d.dot(axisV) - offsetV];
  };

  const u0 = -width  / 2 - MASK_PAD;
  const v0 = -height / 2 - MASK_PAD;
  const cols = Math.max(8, Math.ceil((width  + 2 * MASK_PAD) / MASK_CELL));
  const rows = Math.max(8, Math.ceil((height + 2 * MASK_PAD) / MASK_CELL));
  const data = new Uint8Array(cols * rows);

  for (const t of triangles) {
    rasterizeTri(data, cols, rows, u0, v0, MASK_CELL,
      project(t.a), project(t.b), project(t.c));
  }
  // Stronger cleanup so the boundary that follows is one continuous run
  // and not a noisy fringe: 2× close (bridges multi-cell gaps along the
  // furthest edges of the plane) → open (drops single-cell flecks that
  // would otherwise become spurious polygon spikes) → fillHoles (kills any
  // interior void left by chimneys / dormers / shadow triangles).
  morphClose(data, cols, rows);
  morphClose(data, cols, rows);
  morphOpen (data, cols, rows);
  fillHoles (data, cols, rows);

  return { data, cols, rows, u0, v0, cell: MASK_CELL };
}

function cloneGrid(g) {
  return { data: new Uint8Array(g.data), cols: g.cols, rows: g.rows, u0: g.u0, v0: g.v0, cell: g.cell };
}

function rasterizeTri(data, cols, rows, u0, v0, cell, A, B, C) {
  const minU = Math.min(A[0], B[0], C[0]);
  const maxU = Math.max(A[0], B[0], C[0]);
  const minV = Math.min(A[1], B[1], C[1]);
  const maxV = Math.max(A[1], B[1], C[1]);
  const i0 = Math.max(0, Math.floor((minU - u0) / cell));
  const i1 = Math.min(cols - 1, Math.floor((maxU - u0) / cell));
  const j0 = Math.max(0, Math.floor((minV - v0) / cell));
  const j1 = Math.min(rows - 1, Math.floor((maxV - v0) / cell));
  const denom = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
  if (Math.abs(denom) < 1e-12) return;
  for (let j = j0; j <= j1; j++) {
    const py = v0 + (j + 0.5) * cell;
    for (let i = i0; i <= i1; i++) {
      const px = u0 + (i + 0.5) * cell;
      const w1 = ((B[1] - C[1]) * (px - C[0]) + (C[0] - B[0]) * (py - C[1])) / denom;
      const w2 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (py - C[1])) / denom;
      const w3 = 1 - w1 - w2;
      if (w1 >= -1e-6 && w2 >= -1e-6 && w3 >= -1e-6) data[j * cols + i] = 1;
    }
  }
}

function morphClose(data, cols, rows) {
  const tmp = new Uint8Array(data.length);
  // Dilate (4-connected) into tmp
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      if (data[idx] ||
        (i > 0        && data[idx - 1]) ||
        (i < cols - 1 && data[idx + 1]) ||
        (j > 0        && data[idx - cols]) ||
        (j < rows - 1 && data[idx + cols])) {
        tmp[idx] = 1;
      }
    }
  }
  // Erode tmp back into data
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      if (tmp[idx] &&
        (i === 0        || tmp[idx - 1]) &&
        (i === cols - 1 || tmp[idx + 1]) &&
        (j === 0        || tmp[idx - cols]) &&
        (j === rows - 1 || tmp[idx + cols])) {
        data[idx] = 1;
      } else {
        data[idx] = 0;
      }
    }
  }
}

// Flood-fill the empty exterior from the grid border, then mark every
// remaining empty cell as filled — i.e. fill all interior holes.
function fillHoles(data, cols, rows) {
  const visited = new Uint8Array(data.length);
  const stack = [];
  const push = (i, j) => {
    if (i < 0 || j < 0 || i >= cols || j >= rows) return;
    const idx = j * cols + i;
    if (visited[idx] || data[idx]) return;
    visited[idx] = 1;
    stack.push(idx);
  };
  for (let i = 0; i < cols; i++) { push(i, 0); push(i, rows - 1); }
  for (let j = 0; j < rows; j++) { push(0, j); push(cols - 1, j); }
  while (stack.length) {
    const idx = stack.pop();
    const j = (idx / cols) | 0;
    const i = idx - j * cols;
    push(i - 1, j); push(i + 1, j); push(i, j - 1); push(i, j + 1);
  }
  // Anything empty and not reached from the outside is an interior hole → fill
  for (let k = 0; k < data.length; k++) {
    if (!data[k] && !visited[k]) data[k] = 1;
  }
}

/**
 * Extract the largest filled region's outline from a binary raster as a
 * simplified polygon in plane-local (u,v) coordinates.
 */
export function extractPolygon(grid) {
  const { data, cols, rows, u0, v0, cell } = grid;
  const filled = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && !!data[j * cols + i];

  // Each cell corner is a vertex with id = i * (rows+1) + j  (i in [0..cols], j in [0..rows])
  const VR = rows + 1;
  const corner = (i, j) => i * VR + j;
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };

  // Emit boundary edge for every filled-cell side that faces an empty/out cell.
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (!filled(i, j)) continue;
      if (!filled(i, j - 1)) link(corner(i, j),     corner(i + 1, j));     // bottom
      if (!filled(i, j + 1)) link(corner(i, j + 1), corner(i + 1, j + 1)); // top
      if (!filled(i - 1, j)) link(corner(i, j),     corner(i, j + 1));     // left
      if (!filled(i + 1, j)) link(corner(i + 1, j), corner(i + 1, j + 1)); // right
    }
  }
  if (adj.size === 0) return null;

  const visited = new Set();
  const ekey = (a, b) => a < b ? a + '|' + b : b + '|' + a;
  const loops = [];

  for (const start of adj.keys()) {
    for (const first of adj.get(start)) {
      if (visited.has(ekey(start, first))) continue;
      visited.add(ekey(start, first));
      const loop = [start, first];
      let prev = start, cur = first, safety = 0;
      while (safety++ < 200000) {
        const opts = adj.get(cur) || [];
        let pick = null;
        for (const o of opts) {
          if (o === prev) continue;
          if (visited.has(ekey(cur, o))) continue;
          pick = o; break;
        }
        if (pick == null) break;
        visited.add(ekey(cur, pick));
        if (pick === start) break;
        loop.push(pick);
        prev = cur; cur = pick;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  if (!loops.length) return null;

  // Convert to (u,v) coords; pick the loop with largest area.
  const toPts = (loop) => loop.map(k => {
    const i = Math.floor(k / VR);
    const j = k - i * VR;
    return [u0 + i * cell, v0 + j * cell];
  });
  let best = null;
  for (const loop of loops) {
    const pts = toPts(loop);
    const a = Math.abs(signedArea(pts));
    if (!best || a > best.area) best = { pts, area: a };
  }
  if (!best || best.area < 1) return null;
  if (signedArea(best.pts) < 0) best.pts.reverse();

  // SHARP-EDGE polygon: aggressive Douglas-Peucker keeps only the corners
  // where the boundary changes direction by more than the staircase noise.
  // Anything closer than ~3 cells to its chord is discarded → the surviving
  // vertices are the FURTHEST points of the silhouette and the edges
  // between them are the longest straight runs supported by the raster.
  // No Chaikin afterwards — we want hard corners, not rounded ones.
  const eps = Math.max(cell * 2.5, 0.5);
  let simplified = douglasPeucker(best.pts, eps);
  // Drop near-collinear vertices left over by DP at high tolerance, so we
  // don't carry tiny zig-zags between two long sides.
  simplified = dropCollinear(simplified, eps * 0.4);
  return simplified;
}

// Remove a vertex if the perpendicular distance from it to the chord
// connecting its neighbours is below `tol` — kills sub-cell zig-zags that
// DP at high epsilon can leave behind on long edges.
function dropCollinear(pts, tol) {
  if (pts.length < 4) return pts;
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[(i - 1 + n) % n];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    const dx = x2 - x0, dy = y2 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const dist = Math.abs(dy * x1 - dx * y1 + x2 * y0 - y2 * x0) / len;
    if (dist > tol) out.push(pts[i]);
  }
  return out.length >= 3 ? out : pts;
}

// Chaikin corner-cutting on a closed polygon. Each pass replaces every
// vertex with two new ones at 1/4 and 3/4 along each edge.
function chaikin(pts, iterations = 1) {
  let cur = pts;
  for (let k = 0; k < iterations; k++) {
    if (cur.length < 4) return cur;
    const out = [];
    for (let i = 0; i < cur.length; i++) {
      const [x0, y0] = cur[i];
      const [x1, y1] = cur[(i + 1) % cur.length];
      out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
      out.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    cur = out;
  }
  return cur;
}

function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s * 0.5;
}

// Douglas–Peucker simplification on a closed polygon
function douglasPeucker(pts, eps) {
  if (pts.length < 4) return pts;
  // Anchor at the two most-distant points so DP doesn't degenerate
  let i0 = 0, i1 = 1, dMax = -1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1];
      const d = dx * dx + dy * dy;
      if (d > dMax) { dMax = d; i0 = i; i1 = j; }
    }
  }
  const left  = pts.slice(i0, i1 + 1);
  const right = pts.slice(i1).concat(pts.slice(0, i0 + 1));
  const a = dpRecursive(left,  eps);
  const b = dpRecursive(right, eps);
  // Stitch (drop duplicate endpoints)
  return a.concat(b.slice(1, -1));
}

function dpRecursive(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let dMax = 0, idx = 0;
  const [x0, y0] = pts[0], [x1, y1] = pts[pts.length - 1];
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
    const projx = x0 + dx * t, projy = y0 + dy * t;
    const d2 = (px - projx) ** 2 + (py - projy) ** 2;
    if (d2 > dMax) { dMax = d2; idx = i; }
  }
  if (Math.sqrt(dMax) > eps) {
    const left  = dpRecursive(pts.slice(0, idx + 1), eps);
    const right = dpRecursive(pts.slice(idx),        eps);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[pts.length - 1]];
}

// ──────────────────────────────────────────────────────────────────────────
// Erase API — actually carves the plane's raster mask, then re-extracts the
// polygon outline. This is what the user sees as the cut-out roof shape.
// ──────────────────────────────────────────────────────────────────────────

/** Zero raster cells along a freehand stroke (array of [u,v] points) with
 *  the given brush radius (metres). Returns the new polygon mask. */
export function eraseStroke(plane, points, radius = 0.6) {
  const g = plane.grid;
  if (!g || !points?.length) return plane.mask;
  const r2 = radius * radius;
  const stamp = (cu, cv) => {
    const i0 = Math.max(0, Math.floor((cu - radius - g.u0) / g.cell));
    const i1 = Math.min(g.cols - 1, Math.floor((cu + radius - g.u0) / g.cell));
    const j0 = Math.max(0, Math.floor((cv - radius - g.v0) / g.cell));
    const j1 = Math.min(g.rows - 1, Math.floor((cv + radius - g.v0) / g.cell));
    for (let j = j0; j <= j1; j++) {
      const py = g.v0 + (j + 0.5) * g.cell;
      for (let i = i0; i <= i1; i++) {
        const px = g.u0 + (i + 0.5) * g.cell;
        if ((px - cu) ** 2 + (py - cv) ** 2 <= r2) g.data[j * g.cols + i] = 0;
      }
    }
  };
  // Sample along each segment so fast strokes don't leave gaps
  const step = Math.max(g.cell * 0.5, radius * 0.5);
  for (let k = 0; k < points.length; k++) {
    const [cu, cv] = points[k];
    stamp(cu, cv);
    if (k < points.length - 1) {
      const [nu, nv] = points[k + 1];
      const dx = nu - cu, dy = nv - cv;
      const dist = Math.hypot(dx, dy);
      if (dist > step) {
        const n = Math.ceil(dist / step);
        for (let s = 1; s < n; s++) {
          const t = s / n;
          stamp(cu + dx * t, cv + dy * t);
        }
      }
    }
  }
  plane.mask = extractPolygon(g);
  plane.cutOps = (plane.cutOps ?? 0) + 1;
  return plane.mask;
}

/** Restore the mask raster to its detection-time original state. */
export function eraseReset(plane) {
  if (!plane.gridOriginal) return plane.mask;
  plane.grid.data.set(plane.gridOriginal.data);
  plane.mask = extractPolygon(plane.grid);
  plane.cutOps = 0;
  return plane.mask;
}

/** Erase every cell inside a closed lasso polygon (in plane-local (u,v)). */
export function eraseLasso(plane, polygonPts) {
  const g = plane.grid;
  if (!g || !polygonPts || polygonPts.length < 3) return plane.mask;
  // Polygon bbox in grid coords
  let mnU = Infinity, mxU = -Infinity, mnV = Infinity, mxV = -Infinity;
  for (const [u, v] of polygonPts) {
    if (u < mnU) mnU = u; if (u > mxU) mxU = u;
    if (v < mnV) mnV = v; if (v > mxV) mxV = v;
  }
  const i0 = Math.max(0, Math.floor((mnU - g.u0) / g.cell));
  const i1 = Math.min(g.cols - 1, Math.floor((mxU - g.u0) / g.cell));
  const j0 = Math.max(0, Math.floor((mnV - g.v0) / g.cell));
  const j1 = Math.min(g.rows - 1, Math.floor((mxV - g.v0) / g.cell));
  for (let j = j0; j <= j1; j++) {
    const py = g.v0 + (j + 0.5) * g.cell;
    for (let i = i0; i <= i1; i++) {
      const px = g.u0 + (i + 0.5) * g.cell;
      if (pointInPolygon(px, py, polygonPts)) g.data[j * g.cols + i] = 0;
    }
  }
  plane.mask = extractPolygon(g);
  plane.cutOps = (plane.cutOps ?? 0) + 1;
  return plane.mask;
}

/** Sharpen the active roof's outline into a straight-line polygon and
 *  EXTRAPOLATE it outward so the new mask strictly contains the old one
 *  (never shrinks). For raster-backed roofs we re-clean the grid first
 *  (close → open → fillHoles → re-extract); for user-drawn polygons we
 *  go straight to DP simplification + inflation. No curves, no Chaikin. */
export function smoothMaskGrid(plane, iterations = 2) {
  let pts = plane.mask;
  const g = plane.grid;
  if (g) {
    // Raster-backed: clean the binary mask, then trace it again into a
    // sharp DP polygon (extractPolygon no longer applies any smoothing).
    for (let k = 0; k < iterations; k++) morphClose(g.data, g.cols, g.rows);
    morphOpen(g.data, g.cols, g.rows);
    fillHoles(g.data, g.cols, g.rows);
    pts = extractPolygon(g) || pts;
  } else if (pts && pts.length >= 3) {
    // User-drawn / merged polygon with no grid. Run aggressive DP so any
    // sub-metre zigzags collapse into long straight runs.
    const diag = Math.hypot(plane.width, plane.height);
    const eps = Math.max(diag * 0.015, 0.4);
    pts = douglasPeucker(pts, eps);
    pts = dropNearCollinearPolygon(pts, eps * 0.4);
  }
  if (!pts || pts.length < 3) return plane.mask;
  // Always EXTRAPOLATE outward — the smoothed polygon must contain the
  // original outline, never slice into it.
  pts = inflatePolygon(pts, Math.max(plane.width, plane.height));
  // Ensure CCW so ShapeGeometry winds the fill outward.
  if (signedArea(pts) < 0) pts.reverse();
  plane.mask = pts;
  return plane.mask;
}

// Push every vertex outward from the polygon's centroid by a small margin
// so the resulting polygon strictly contains the input. Margin scales with
// polygon size so big roofs grow proportionally and tiny ones still get a
// visible nudge.
function inflatePolygon(pts, longSide) {
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= pts.length; cy /= pts.length;
  const margin = Math.max(longSide * 0.025, 0.25);
  return pts.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return [x, y];
    const k = (len + margin) / len;
    return [cx + dx * k, cy + dy * k];
  });
}

// Drop a vertex if it's almost collinear with its neighbours (sub-`tol`
// distance to the chord). Keeps real corners, kills DP leftover zig-zags.
function dropNearCollinearPolygon(pts, tol) {
  if (pts.length < 4) return pts;
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[(i - 1 + n) % n];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    const dx = x2 - x0, dy = y2 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const dist = Math.abs(dy * x1 - dx * y1 + x2 * y0 - y2 * x0) / len;
    if (dist > tol) out.push(pts[i]);
  }
  return out.length >= 3 ? out : pts;
}

/** Erode then dilate (4-connected) — removes 1-cell spurs / serrated edges. */
function morphOpen(data, cols, rows) {
  const tmp = new Uint8Array(data.length);
  // Erode into tmp
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      if (data[idx] &&
        (i === 0        || data[idx - 1]) &&
        (i === cols - 1 || data[idx + 1]) &&
        (j === 0        || data[idx - cols]) &&
        (j === rows - 1 || data[idx + cols])) {
        tmp[idx] = 1;
      }
    }
  }
  // Dilate tmp back into data
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      if (tmp[idx] ||
        (i > 0        && tmp[idx - 1]) ||
        (i < cols - 1 && tmp[idx + 1]) ||
        (j > 0        && tmp[idx - cols]) ||
        (j < rows - 1 && tmp[idx + cols])) {
        data[idx] = 1;
      } else {
        data[idx] = 0;
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Public detection API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Detect ONE roof from a single seed (click). Uses connectivity flood-fill
 * so the plane stops at geometric discontinuities — it cannot stretch across
 * the scene any more.
 */
export function detectRoofPlane({
  upTriangles, seedPoint, seedNormal,
  cropBounds = null, localRadius = null,
  groundY = null, minHeightAboveGround = 5,
}) {
  if (!upTriangles?.length) return { ok: false, reason: 'no upward triangles indexed' };

  // Restrict to crop region if any. If no crop, use a local box around the
  // seed (so the flood-fill cannot escape across the entire scene through a
  // long chain of small connected triangles).
  const localBounds = (!cropBounds && localRadius)
    ? {
        minX: seedPoint.x - localRadius, maxX: seedPoint.x + localRadius,
        minZ: seedPoint.z - localRadius, maxZ: seedPoint.z + localRadius,
      }
    : null;
  const bounds = cropBounds || localBounds;
  // Roofs always sit a few metres above ground. Cull every triangle below
  // groundY + minHeightAboveGround so the flood-fill cannot leak onto
  // sidewalks, terrain, courtyards, or low garage tops.
  const minY = (groundY != null) ? (groundY + minHeightAboveGround) : -Infinity;
  const inRegion = (t) => (t.cy >= minY) && (!bounds || (
    t.cx >= bounds.minX && t.cx <= bounds.maxX &&
    t.cz >= bounds.minZ && t.cz <= bounds.maxZ
  ));

  // If the user clicked below the threshold, bail out cleanly rather than
  // returning the closest above-ground patch — that would feel like the
  // click jumped to another roof.
  if (seedPoint.y < minY) {
    return { ok: false, reason: `click is below ground+${minHeightAboveGround.toFixed(1)} m threshold` };
  }

  const hash = buildHash(upTriangles, inRegion);
  const seedIdx = findNearestIndex(upTriangles, hash, seedPoint, seedNormal);
  if (seedIdx < 0) return { ok: false, reason: 'no triangle near click' };

  const cluster = floodFill(upTriangles, hash, seedIdx, new Set());
  if (cluster.length < 3) {
    return { ok: false, reason: `cluster=${cluster.length} (no continuous patch)` };
  }
  const fit = fitPlane(cluster);
  if (!fit.ok) return fit;
  // Hard reject planes whose centre is below the height threshold, even if
  // the cluster slipped through (e.g. a tilted slab spanning the gate).
  if (fit.plane.centre.y < minY) {
    return { ok: false, reason: `plane centre y=${fit.plane.centre.y.toFixed(1)} below ground+${minHeightAboveGround.toFixed(1)} m` };
  }
  fit.plane.clusterSize = cluster.length;
  return fit;
}

// ──────────────────────────────────────────────────────────────────────────
// User-defined polygon roof. The user clicks corners on the model (each
// click is raycast into 3D), and those points become the roof outline
// directly — no plane fitting against geometry, no flood fill. The plane
// itself is the best-fit plane through the clicked corners (Newell's
// method handles slightly non-coplanar points robustly).
// ──────────────────────────────────────────────────────────────────────────
export function roofFromPolygon(points) {
  if (!points || points.length < 3) {
    return { ok: false, reason: `need ≥3 corner points, got ${points?.length ?? 0}` };
  }
  // 1. Newell's method → robust normal even when corners are slightly off-plane
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  let normal = new THREE.Vector3(nx, ny, nz);
  if (normal.lengthSq() < 1e-9) return { ok: false, reason: 'corner points are colinear' };
  normal.normalize();
  // Force normal to point upward (roofs face up)
  if (normal.y < 0) normal.multiplyScalar(-1);

  // 2. Centroid (true average of corners)
  const centroid = new THREE.Vector3();
  for (const p of points) centroid.add(p);
  centroid.multiplyScalar(1 / points.length);

  // 3. In-plane axes — start from world up, then PCA-align so u/v hug the
  //    polygon's principal directions (long edge along u).
  const worldUp = new THREE.Vector3(0, 1, 0);
  let u = new THREE.Vector3().crossVectors(worldUp, normal);
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
  u.normalize();
  let v = new THREE.Vector3().crossVectors(normal, u).normalize();

  // Project to (u,v), compute covariance, rotate basis to principal axes
  const proj = points.map((p) => {
    const d = p.clone().sub(centroid);
    return [d.dot(u), d.dot(v)];
  });
  let mx = 0, my = 0;
  proj.forEach(([x, y]) => { mx += x; my += y; });
  mx /= proj.length; my /= proj.length;
  let cxx = 0, cxy = 0, cyy = 0;
  proj.forEach(([x, y]) => {
    const dx = x - mx, dy = y - my;
    cxx += dx * dx; cxy += dx * dy; cyy += dy * dy;
  });
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const u2 = u.clone().multiplyScalar(cosT).addScaledVector(v,  sinT).normalize();
  const v2 = u.clone().multiplyScalar(-sinT).addScaledVector(v, cosT).normalize();

  // 4. Project the actual corners into the rotated basis. Bbox → centre & size.
  const local = points.map((p) => {
    const d = p.clone().sub(centroid);
    return [d.dot(u2), d.dot(v2)];
  });
  let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
  local.forEach(([x, y]) => {
    if (x < pMinX) pMinX = x;
    if (x > pMaxX) pMaxX = x;
    if (y < pMinY) pMinY = y;
    if (y > pMaxY) pMaxY = y;
  });
  const width  = pMaxX - pMinX;
  const height = pMaxY - pMinY;
  if (width * height < 0.01) return { ok: false, reason: 'polygon area is essentially zero' };

  const centre = centroid.clone()
    .addScaledVector(u2, (pMinX + pMaxX) / 2)
    .addScaledVector(v2, (pMinY + pMaxY) / 2);

  // 5. Mask in plane-local frame relative to `centre` so the visualisation
  //    transform in Scene.jsx (translate to centre, rotate to u/v/normal
  //    basis) lines the polygon up with the clicked corners.
  //
  //    Edges are kept perfectly STRAIGHT \u2014 no Chaikin, no smoothing. And
  //    because the clicked 3D points aren't usually exactly coplanar, naive
  //    projection onto the fitted plane shrinks the polygon inward from
  //    where the user actually clicked. To honour the user's intent we
  //    EXTRAPOLATE: each vertex is pushed outward from the centroid by a
  //    margin that's the larger of (a) the worst out-of-plane deviation of
  //    any click and (b) a small fraction of the polygon's diagonal. This
  //    guarantees the resulting polygon strictly contains every clicked
  //    point rather than slicing through them.
  const rawMask = points.map((p) => {
    const d = p.clone().sub(centre);
    return [d.dot(u2), d.dot(v2)];
  });
  // Centroid of the projected mask (use this as the inflation pivot \u2014 it
  // sits at the visual middle of the polygon, not the bbox centre).
  let mcx = 0, mcy = 0;
  for (const [x, y] of rawMask) { mcx += x; mcy += y; }
  mcx /= rawMask.length; mcy /= rawMask.length;
  // Worst perpendicular distance of any clicked point from the fitted plane.
  let maxDev = 0;
  const planeD = -normal.dot(centre);
  for (const p of points) {
    const dev = Math.abs(normal.x * p.x + normal.y * p.y + normal.z * p.z + planeD);
    if (dev > maxDev) maxDev = dev;
  }
  const diag = Math.hypot(width, height);
  const margin = Math.max(maxDev * 1.25, diag * 0.04, 0.25); // \u22650.25\u202fm
  let mask = rawMask.map(([x, y]) => {
    const dx = x - mcx, dy = y - mcy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return [x, y];
    const k = (len + margin) / len;
    return [mcx + dx * k, mcy + dy * k];
  });
  // Ensure CCW winding so ShapeGeometry produces a forward-facing fill.
  if (signedArea(mask) < 0) mask.reverse();
  // Recompute width/height/area off the inflated mask so panel layout and
  // overlap checks use the actual outer extent.
  let iMinX = Infinity, iMaxX = -Infinity, iMinY = Infinity, iMaxY = -Infinity;
  for (const [x, y] of mask) {
    if (x < iMinX) iMinX = x;
    if (x > iMaxX) iMaxX = x;
    if (y < iMinY) iMinY = y;
    if (y > iMaxY) iMaxY = y;
  }
  const widthOut  = iMaxX - iMinX;
  const heightOut = iMaxY - iMinY;

  const tiltDeg = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(-1, normal.y))));
  const azimuth = THREE.MathUtils.radToDeg(Math.atan2(u2.x, u2.z));

  return {
    ok: true,
    plane: {
      normal, u: u2, v: v2,
      centre, width: widthOut, height: heightOut,
      area: widthOut * heightOut,
      tilt: tiltDeg, azimuth,
      inlierCount: 0,
      mask,
      grid: null,
      gridOriginal: null,
      cutOps: 0,
      userDrawn: true,
    },
  };
}

/**
 * Detect EVERY continuous roof plane inside an XZ rectangle. Returns one
 * plane per connected cluster, sorted by area descending.
 */
export function detectRoofsInArea({
  upTriangles, areaBounds, minClusterTriangles = 8, triangleFilter = null,
  groundY = null, minHeightAboveGround = 5,
}) {
  if (!upTriangles?.length) return { ok: false, reason: 'no upward triangles indexed', planes: [] };
  if (!areaBounds && !triangleFilter) return { ok: false, reason: 'no area bounds', planes: [] };

  // Roofs sit a few metres above ground — cull anything below that.
  const minY = (groundY != null) ? (groundY + minHeightAboveGround) : -Infinity;
  const aboveGround = (t) => t.cy >= minY;
  const inBox = areaBounds
    ? (t) => t.cx >= areaBounds.minX && t.cx <= areaBounds.maxX &&
             t.cz >= areaBounds.minZ && t.cz <= areaBounds.maxZ
    : () => true;
  const inRegion = triangleFilter
    ? (t) => aboveGround(t) && inBox(t) && triangleFilter(t)
    : (t) => aboveGround(t) && inBox(t);

  const hash = buildHash(upTriangles, inRegion);
  const visited = new Set();
  const planes = [];
  const stats = { clusters: 0, kept: 0, dropped: 0 };

  // Iterate triangles in deterministic order (largest area first → big roofs win)
  const indicesInRegion = [];
  for (let i = 0; i < upTriangles.length; i++) {
    if (inRegion(upTriangles[i])) indicesInRegion.push(i);
  }
  indicesInRegion.sort((a, b) => upTriangles[b].area - upTriangles[a].area);

  for (const i of indicesInRegion) {
    if (visited.has(i)) continue;
    const cluster = floodFill(upTriangles, hash, i, visited);
    stats.clusters++;
    if (cluster.length < minClusterTriangles) { stats.dropped++; continue; }
    const fit = fitPlane(cluster);
    if (!fit.ok) { stats.dropped++; continue; }
    // Belt-and-braces: drop any plane whose centre still sits below the
    // ground threshold (can happen if a thin sloped strip averaged low).
    if (fit.plane.centre.y < minY) { stats.dropped++; continue; }
    fit.plane.clusterSize = cluster.length;
    planes.push(fit.plane);
    stats.kept++;
  }
  planes.sort((a, b) => b.area - a.area);
  return { ok: planes.length > 0, planes, stats };
}

// ──────────────────────────────────────────────────────────────────────────
// Merge several detected roof planes into ONE clean mask. Useful when a
// real-world roof was split into multiple segments by chimneys or windows
// occluding the geometry — pick them all and merge into a single polygon.
// Strategy: project every filled raster cell of every source roof onto the
// largest roof's plane (the reference frame), splat into a unified grid,
// morph-close (fills small gaps between segments), extract polygon.
// ──────────────────────────────────────────────────────────────────────────
export function mergeRoofPlanes(planes) {
  if (!planes || planes.length < 2) return { ok: false, reason: 'need ≥2 planes' };
  const ref = planes.reduce((a, b) => (a.area >= b.area ? a : b));
  const refU = ref.u, refV = ref.v, refN = ref.normal, refC = ref.centre;

  // 1. Collect projected (u,v) coords of every filled cell across all planes
  const local = [];
  let mnU = Infinity, mxU = -Infinity, mnV = Infinity, mxV = -Infinity;
  for (const pl of planes) {
    const g = pl.grid;
    if (!g) continue;
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.cols; i++) {
        if (!g.data[j * g.cols + i]) continue;
        const lu = g.u0 + (i + 0.5) * g.cell;
        const lv = g.v0 + (j + 0.5) * g.cell;
        const w = pl.centre.clone()
          .addScaledVector(pl.u, lu)
          .addScaledVector(pl.v, lv);
        const d = w.sub(refC);
        // Reject points too far off the reference plane (>1m) — defends
        // against merging wildly unrelated slopes.
        if (Math.abs(d.dot(refN)) > 1.5) continue;
        const u = d.dot(refU), v = d.dot(refV);
        local.push([u, v]);
        if (u < mnU) mnU = u; if (u > mxU) mxU = u;
        if (v < mnV) mnV = v; if (v > mxV) mxV = v;
      }
    }
  }
  if (local.length < 8) return { ok: false, reason: `merge produced ${local.length} pts` };

  // 2. Rasterize into a unified grid centred on the bbox midpoint
  const cu = (mnU + mxU) / 2, cv = (mnV + mxV) / 2;
  const width  = (mxU - mnU);
  const height = (mxV - mnV);
  const u0 = -width  / 2 - MASK_PAD;
  const v0 = -height / 2 - MASK_PAD;
  const cols = Math.max(8, Math.ceil((width  + 2 * MASK_PAD) / MASK_CELL));
  const rows = Math.max(8, Math.ceil((height + 2 * MASK_PAD) / MASK_CELL));
  const data = new Uint8Array(cols * rows);
  for (const [u, v] of local) {
    const i = Math.floor((u - cu - u0) / MASK_CELL);
    const j = Math.floor((v - cv - v0) / MASK_CELL);
    if (i >= 0 && i < cols && j >= 0 && j < rows) data[j * cols + i] = 1;
  }
  // Aggressive close to bridge gaps between previously-separate segments
  morphClose(data, cols, rows);
  morphClose(data, cols, rows);
  morphClose(data, cols, rows);
  // Fill any holes left between merged segments → single complete contour
  fillHoles(data, cols, rows);

  const grid = { data, cols, rows, u0, v0, cell: MASK_CELL };
  const mask = extractPolygon(grid);
  if (!mask) return { ok: false, reason: 'merged mask extraction failed' };

  const newCentre = refC.clone()
    .addScaledVector(refU, cu)
    .addScaledVector(refV, cv);
  const tilt = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(-1, refN.y))));
  const azimuth = THREE.MathUtils.radToDeg(Math.atan2(refU.x, refU.z));

  return {
    ok: true,
    plane: {
      normal: refN.clone(), u: refU.clone(), v: refV.clone(),
      centre: newCentre, width, height, area: width * height,
      tilt, azimuth,
      inlierCount: local.length,
      mask, grid, gridOriginal: cloneGrid(grid),
      cutOps: 0, clusterSize: planes.reduce((s, p) => s + (p.clusterSize || 0), 0),
    },
  };
}

function findNearestIndex(triangles, hash, point, seedNormal) {
  // Search the click bucket and 1-ring of neighbours for the closest centroid
  // whose normal roughly matches the seed.
  const kx = Math.floor(point.x / BUCKET);
  const kz = Math.floor(point.z / BUCKET);
  let best = -1, bestD = Infinity;
  const tol = Math.cos(THREE.MathUtils.degToRad(30));
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const arr = hash.get((kx + dx) + ',' + (kz + dz));
      if (!arr) continue;
      for (const j of arr) {
        const t = triangles[j];
        if (seedNormal && t.n.dot(seedNormal) < tol) continue;
        const ddx = t.cx - point.x, ddz = t.cz - point.z, ddy = t.cy - point.y;
        const d = ddx * ddx + ddz * ddz + ddy * ddy;
        if (d < bestD) { bestD = d; best = j; }
      }
    }
  }
  return best;
}

function normalizeHalfTurnRad(angle) {
  while (angle <= -Math.PI / 2) angle += Math.PI;
  while (angle >   Math.PI / 2) angle -= Math.PI;
  return angle;
}

function normalizeQuarterTurnRad(angle) {
  while (angle <= -Math.PI / 4) angle += Math.PI / 2;
  while (angle >   Math.PI / 4) angle -= Math.PI / 2;
  return angle;
}

/**
 * Polygon oriented-bounding-box angle (long-axis direction) used as a
 * fallback when the roof is too flat to have a meaningful slope direction.
 */
function roofPolygonLongAxisDeg(plane) {
  const poly = plane.mask;
  if (!Array.isArray(poly) || poly.length < 2) return 0;

  let bestArea = Infinity;
  let bestAngle = 0;
  let bestWidth = 0;
  let bestHeight = 0;
  let bestEdgeLen = 0;

  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const edgeLen = Math.hypot(dx, dy);
    if (edgeLen < 1e-6) continue;

    const angle = normalizeQuarterTurnRad(Math.atan2(dy, dx));
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [px, py] of poly) {
      const rx =  px * cosA + py * sinA;
      const ry = -px * sinA + py * cosA;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const area = width * height;
    if (
      area < bestArea - 1e-6 ||
      (Math.abs(area - bestArea) <= 1e-6 && edgeLen > bestEdgeLen)
    ) {
      bestArea = area;
      bestAngle = angle;
      bestWidth = width;
      bestHeight = height;
      bestEdgeLen = edgeLen;
    }
  }

  if (!Number.isFinite(bestArea)) return 0;
  if (bestHeight > bestWidth) bestAngle += Math.PI / 2;
  return THREE.MathUtils.radToDeg(normalizeHalfTurnRad(bestAngle));
}

/**
 * Compute the canonical in-plane panel angle (degrees) so that the panel's
 * "optical flow" axis (vHat in the layout code: long axis in portrait, short
 * axis in landscape) points DOWN the roof's slope — i.e. from the highest
 * point of the plane to the lowest point as projected onto the ground.
 *
 * The downhill direction inside the plane is the projection of world-down
 * (0,-1,0) onto the plane, expressed in the plane's (u, v) basis as
 *   (gradU, gradV) = (-plane.u.y, -plane.v.y).
 * In the layout code vHat = (-sinA, cosA) in (u, v) coords, so to align vHat
 * with (gradU, gradV) we need A = atan2(-gradU, gradV) = atan2(u.y, -v.y).
 *
 * For nearly-horizontal roofs the gradient vanishes and we fall back to the
 * polygon long-axis direction so the panels still look orderly.
 */
export function roofAutoAngleDeg(plane) {
  const gradU = -plane.u.y;
  const gradV = -plane.v.y;
  const gradLen = Math.hypot(gradU, gradV);
  // Use slope direction whenever the roof has any tilt (~0.3° minimum).
  // Only truly flat roofs fall back to the polygon long-axis heuristic.
  if (gradLen < 0.005) return roofPolygonLongAxisDeg(plane);
  const angle = Math.atan2(-gradU, gradV);
  return THREE.MathUtils.radToDeg(normalizeHalfTurnRad(angle));
}

/**
 * Place panels on a detected roof plane by raycasting straight onto the
 * actual surface (so panels follow real geometry, not the flat fit).
 */
export function generatePanelLayout({ plane, panelType, scale, gap, raycaster, meshes, erased = [], angleDeg = 0, autoAlign = false, surfaceOffset = 0.12, landscape = false, tiltDeg = 0 }) {
  // ── 1. Base in-plane axes ────────────────────────────────────────────
  // We need a 2D orthonormal basis (uPlane, vPlane) inside the roof plane
  // such that vPlane points DOWNHILL (from highest to lowest point of the
  // plane as projected onto the ground). The panel's "optical-flow" axis
  // — the long edge in portrait, the short edge in landscape — will run
  // along vPlane, matching the user-facing spec.
  //
  // Downhill in 3D is the projection of world-down (0,-1,0) onto the
  // plane: d = -ŷ - (-ŷ·n) n = -ŷ + n.y · n
  let vPlane3, uPlane3;
  const n = plane.normal;
  const dY = -n.y; // (-ŷ) · n
  const downX = 0      - dY * n.x;
  const downY = -1     - dY * n.y;
  const downZ = 0      - dY * n.z;
  const downLen = Math.hypot(downX, downY, downZ);
  if (autoAlign && downLen > 1e-3) {
    // Slope-aligned basis — independent of plane.u / plane.v rotation
    vPlane3 = new THREE.Vector3(downX / downLen, downY / downLen, downZ / downLen);
    // uPlane = n × vPlane (right-handed → uPlane is horizontal, across the slope)
    uPlane3 = new THREE.Vector3().crossVectors(n, vPlane3).normalize();
  } else {
    // Flat roof or auto-align off → fall back to the plane's own basis
    uPlane3 = plane.u.clone();
    vPlane3 = plane.v.clone();
  }

  // ── 2. Apply manual angle as rotation around the plane normal ────────
  const a    = THREE.MathUtils.degToRad(angleDeg);
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);
  const uHat3 = uPlane3.clone().multiplyScalar(cosA).addScaledVector(vPlane3,  sinA);
  const vHat3 = uPlane3.clone().multiplyScalar(-sinA).addScaledVector(vPlane3, cosA);

  if (typeof window !== 'undefined' && window.__panelDebug) {
    // eslint-disable-next-line no-console
    console.log('[panelLayout]', {
      autoAlign, angleDeg, landscape,
      normal: [n.x.toFixed(3), n.y.toFixed(3), n.z.toFixed(3)],
      downhill: autoAlign && downLen > 1e-3
        ? [vPlane3.x.toFixed(3), vPlane3.y.toFixed(3), vPlane3.z.toFixed(3)]
        : 'fallback',
      vHat: [vHat3.x.toFixed(3), vHat3.y.toFixed(3), vHat3.z.toFixed(3)],
    });
  }

  // ── 3. Express grid axes in the plane's stored (u, v) frame for mask
  //       and erase tests (which use 2D plane-local coords).
  const uHatU = uHat3.dot(plane.u), uHatV = uHat3.dot(plane.v);
  const vHatU = vHat3.dot(plane.u), vHatV = vHat3.dot(plane.v);

  // Portrait (default) = panel height runs along vHat (down-slope when auto-
  // aligned). Landscape swaps so the long edge runs across the slope.
  const baseW = panelType.w * scale;
  const baseH = panelType.h * scale;
  const pw = landscape ? baseH : baseW;
  const ph = landscape ? baseW : baseH;
  const stepW = pw + gap;
  const stepH = ph + gap;

  // 3D vectors used directly for placement & per-panel basis
  const uHat = uHat3;
  const vHat = vHat3;

  const isErased = (u, v) => {
    for (const r of erased) {
      if (u >= r.u1 && u <= r.u2 && v >= r.v1 && v <= r.v2) return true;
    }
    return false;
  };
  const mask = plane.mask;
  const insideMask = (u, v) => !mask || pointInPolygon(u, v, mask);

  const margin = 0.3;
  const halfW = plane.width  / 2 - margin;
  const halfH = plane.height / 2 - margin;

  // Bounding extents along the rotated grid axes — covers the plane's AABB
  // even when the grid is tilted. The mask test filters anything that
  // ultimately falls outside the polygon.
  const absUu = Math.abs(uHatU), absUv = Math.abs(uHatV);
  const absVu = Math.abs(vHatU), absVv = Math.abs(vHatV);
  const coverU = halfW * absUu + halfH * absVu;
  const coverV = halfW * absUv + halfH * absVv;

  const cols = Math.max(0, Math.floor((coverU * 2 + gap) / stepW));
  const rows = Math.max(0, Math.floor((coverV * 2 + gap) / stepH));
  const totalGridW = cols * stepW - gap;
  const totalGridH = rows * stepH - gap;
  const startI = -totalGridW / 2 + pw / 2;
  const startJ = -totalGridH / 2 + ph / 2;

  const negN = plane.normal.clone().negate();
  const cosTol = Math.cos(THREE.MathUtils.degToRad(35));

  // Pre-compute tilt trig once. Tilt rotates the per-panel basis around
  // its width-axis (uHat), so + raises the down-slope edge away from the
  // roof and - raises the up-slope edge.
  const tilt   = THREE.MathUtils.degToRad(tiltDeg);
  const cosT   = Math.cos(tilt);
  const sinT   = Math.sin(tilt);
  // Centre lift to keep the lower edge clearing the roof when tilted.
  const tiltLift = (ph / 2) * Math.abs(sinT);

  // SHARED panel orientation — every panel uses the SAME basis derived from
  // the fitted plane (uHat along the grid width-axis, plane.normal up). This
  // keeps the layout a clean rectangular grid on the conceptual plane,
  // independent of triangle-level surface noise.
  const yAxisBase = plane.normal.clone().multiplyScalar(cosT).addScaledVector(vHat, sinT);
  const zAxisBase = vHat.clone().multiplyScalar(cosT).addScaledVector(plane.normal, -sinT);
  const sharedM    = new THREE.Matrix4().makeBasis(uHat, yAxisBase, zAxisBase);
  const sharedQuat = new THREE.Quaternion().setFromRotationMatrix(sharedM);

  const placements = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Grid-local offsets along uHat / vHat
      const i = startI + c * stepW;
      const j = startJ + r * stepH;
      // Convert to plane (u, v) coords for mask + erase tests by projecting
      // the grid offset (i along uHat, j along vHat) onto plane.u / plane.v.
      const offU = i * uHatU + j * vHatU;
      const offV = i * uHatV + j * vHatV;
      if (isErased(offU, offV)) continue;
      if (!insideMask(offU, offV)) continue;
      // Position ON the fitted plane (used as a fallback if there is no
      // building under this cell).
      const planePoint = plane.centre.clone()
        .addScaledVector(plane.u, offU)
        .addScaledVector(plane.v, offV);

      // Anchor to the actual mesh surface so panels never sink into a
      // bumpy roof. The plane is a least-squares fit, so half the mesh
      // sits above it; using the raycast hit point and lifting along the
      // PLANE normal (not the triangle normal) keeps panels above the
      // surface AND keeps every panel parallel to the conceptual plane.
      let anchor = planePoint;
      if (raycaster && meshes && meshes.length) {
        const start = planePoint.clone().addScaledVector(plane.normal, 30);
        raycaster.set(start, negN);
        raycaster.far = 80;
        const hits = raycaster.intersectObjects(meshes, false);
        if (!hits.length) continue;
        const hn = hits[0].face.normal.clone()
          .transformDirection(hits[0].object.matrixWorld).normalize();
        if (hn.dot(plane.normal) < cosTol) continue;
        // Take the HIGHER of the mesh hit and the fitted plane point along
        // the plane normal. This guarantees the panel sits at or above the
        // visualised plane (which is drawn at `centre + 0.05·normal`) AND
        // above any dip in the actual mesh surface.
        const hitProj   = hits[0].point.clone().sub(plane.centre).dot(plane.normal);
        const planeProj = planePoint.clone().sub(plane.centre).dot(plane.normal);
        anchor = hitProj > planeProj ? hits[0].point.clone() : planePoint;
      }

      // Box geometry is 4 cm thick and centred on `pos`, so 2 cm sits
      // below the centre. Add half the thickness to the surface offset so
      // the box's BOTTOM face hovers at exactly `surfaceOffset` above the
      // anchor — no more visible piercing of the roof.
      const lift = surfaceOffset + 0.02 + tiltLift;
      const pos = anchor.addScaledVector(plane.normal, lift);
      placements.push({ pos, quat: sharedQuat.clone(), w: pw, h: ph });
    }
  }
  return { placements, gridCols: cols, gridRows: rows, angleDeg };
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
