// IndexedDB-backed project store.
//
// Each "project" is one client / one imported 3D model. It bundles together
// everything we need to resume work after the tab is closed:
//   - the original .glb file (as a Blob),
//   - the Tectum intake info (client name, address, …),
//   - the live workspace (detected roofs),
//   - all saved Templates and the Drafts under them,
//   - a JPEG thumbnail of the 3D scene rendered at 45° for the dashboard.
//
// The whole record lives in a single IndexedDB store, so listing all
// projects on the dashboard is a single getAll() call.

const DB_NAME  = 'tectum-projects';
const DB_VER   = 1;
const STORE    = 'projects';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not available'));
    }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function tx(db, mode = 'readonly') {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export function newProjectId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Returns a lightweight summary list (no Blob payload, to keep memory low).
// Pass an `installerId` to restrict the list to that installer's projects;
// records without an installerId (legacy / pre-auth) are also returned so
// nothing is hidden after upgrading.
export async function listProjects(installerId) {
  try {
    const db   = await openDB();
    const recs = await reqToPromise(tx(db).getAll());
    db.close();
    // Strip the heavy modelBlob before handing back to the UI; the
    // dashboard only needs the thumbnail + counts.
    return recs
      .filter(r => !installerId || !r.installerId || r.installerId === installerId)
      .map(({ modelBlob, ...rest }) => ({
        ...rest,
        hasModel: !!modelBlob,
      })).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  } catch (err) {
    console.warn('[projects] list failed:', err);
    return [];
  }
}

export async function getProject(id) {
  const db  = await openDB();
  const rec = await reqToPromise(tx(db).get(id));
  db.close();
  return rec || null;
}

// Upsert a project. Pass partial fields; existing fields you don't
// override are preserved (so the auto-saver can patch templates/drafts
// without re-shipping the .glb blob every time).
export async function saveProject(id, partial) {
  const db   = await openDB();
  const prev = await reqToPromise(tx(db).get(id));
  const next = {
    id,
    name: partial.name ?? prev?.name ?? 'Untitled project',
    intake: partial.intake ?? prev?.intake ?? null,
    installerId: partial.installerId ?? prev?.installerId ?? null,
    modelBlob: partial.modelBlob ?? prev?.modelBlob ?? null,
    modelFileName: partial.modelFileName ?? prev?.modelFileName ?? null,
    thumbnail: partial.thumbnail ?? prev?.thumbnail ?? null,
    roofs: partial.roofs ?? prev?.roofs ?? [],
    templates: partial.templates ?? prev?.templates ?? [],
    drafts: partial.drafts ?? prev?.drafts ?? [],
    createdAt: prev?.createdAt ?? Date.now(),
    savedAt: Date.now(),
  };
  await reqToPromise(tx(db, 'readwrite').put(next));
  db.close();
  return next;
}

export async function deleteProject(id) {
  const db = await openDB();
  await reqToPromise(tx(db, 'readwrite').delete(id));
  db.close();
}

// Convert an object URL (blob:…) back into a Blob so we can persist it.
export async function blobFromObjectUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('blob:')) return null;
  try {
    const res = await fetch(url);
    return await res.blob();
  } catch (err) {
    console.warn('[projects] blob fetch failed:', err);
    return null;
  }
}

// ── Rehydrate ──────────────────────────────────────────────────────────
//
// IndexedDB stores values via structured-clone, which strips class info:
// our THREE.Vector3 / THREE.Quaternion instances come back as plain
// `{x,y,z[,w]}` objects, breaking every `.toArray()` / `.dot()` / `.clone()`
// call downstream. Walk the saved roof / panel structures and rebuild the
// real Three.js instances before handing them to the scene.
import * as THREE from 'three';

function vec3(o) {
  if (!o) return new THREE.Vector3();
  if (o.isVector3) return o;
  return new THREE.Vector3(o.x ?? 0, o.y ?? 0, o.z ?? 0);
}
function quat(o) {
  if (!o) return new THREE.Quaternion();
  if (o.isQuaternion) return o;
  return new THREE.Quaternion(o.x ?? 0, o.y ?? 0, o.z ?? 0, o.w ?? 1);
}
function rehydratePanel(p) {
  return { ...p, pos: vec3(p.pos), quat: quat(p.quat) };
}
function rehydratePlane(plane) {
  if (!plane) return plane;
  return {
    ...plane,
    normal: vec3(plane.normal),
    u:      vec3(plane.u),
    v:      vec3(plane.v),
    centre: vec3(plane.centre),
  };
}
function rehydrateRoof(r) {
  if (!r) return r;
  return {
    ...r,
    plane:  rehydratePlane(r.plane),
    panels: Array.isArray(r.panels) ? r.panels.map(rehydratePanel) : [],
  };
}
function rehydratePanelsByRoof(map) {
  if (!map || typeof map !== 'object') return map;
  const out = {};
  for (const [roofId, panels] of Object.entries(map)) {
    out[roofId] = Array.isArray(panels) ? panels.map(rehydratePanel) : [];
  }
  return out;
}

export function rehydrateProjectState({ roofs, templates, drafts } = {}) {
  return {
    roofs: Array.isArray(roofs) ? roofs.map(rehydrateRoof) : [],
    templates: Array.isArray(templates) ? templates.map(t => ({
      ...t,
      roofs: Array.isArray(t.roofs) ? t.roofs.map(rehydrateRoof) : [],
    })) : [],
    drafts: Array.isArray(drafts) ? drafts.map(d => ({
      ...d,
      panelsByRoof: rehydratePanelsByRoof(d.panelsByRoof),
    })) : [],
  };
}
