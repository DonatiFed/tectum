import { useSyncExternalStore } from 'react';

// Tiny pub-sub store — no external deps
function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set: (partial) => {
      const next = typeof partial === 'function' ? partial(state) : partial;
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
  };
}

export const store = createStore({
  selectedModel: null,         // {name, file, icon}
  loadProgress: 0,             // 0..1
  loaded: false,

  mode: 'orbit',               // 'orbit' | 'crop' | 'select' | 'polygon' | 'pick' | 'erase'
  cropBounds: null,            // {minX, maxX, minZ, maxZ} world coords
  roofs: [],                   // [{ id, plane, panels, erased: [{u1,v1,u2,v2}] }]
  activeRoofId: null,
  mergeIntoActive: true,       // if true, new clicks extend the active roof

  panelTypeIdx: 0,                  // index into PANEL_TYPES, or -1 = use customPanel below
  panelScale: 1,
  panelGap: 0.10,                   // metres between adjacent panels (default ~10 cm)
  panelSurfaceOffset: 0.12,         // metres lift above the roof surface (~12 cm = a hand's breadth)
  // Continuous in-plane rotation of the panel grid, in degrees, around the
  // roof-plane normal. 0 = panels aligned with the plane's natural U axis,
  // 90 = perpendicular. Used as a manual override when panelAutoAlign is off.
  panelAngleDeg: 0,
  // Simple orientation flip on top of the in-plane angle: false = the
  // panel's height runs DOWN the slope (portrait), true = swap so the
  // long edge runs across the slope (landscape).
  panelLandscape: false,
  // Out-of-plane tilt in degrees: rotates each panel around its
  // width-axis (which lies along the ridge when auto-aligned), so the
  // panel face leaves the roof surface. + lifts the down-slope edge,
  // - lifts the up-slope edge. Range \u00b145\u00b0.
  panelTiltDeg: 0,
  // When true, the layout auto-rotates each roof's grid so panel rows run
  // along the ridge / columns run down the slope (computed from the plane
  // normal vs world up). The slider becomes a manual override when off.
  panelAutoAlign: true,
  // User-defined panel spec (used when panelTypeIdx === -1). Different
  // manufacturers have different physical sizes / wattages, so the editor
  // exposes width / height / Wp inputs for a single ad-hoc panel.
  customPanel: { name: 'Custom', w: 1.05, h: 1.75, wp: 410 },

  // ── Tabs ───────────────────────────────────────────────────────────────
  // 'detect'    = roof detection workspace (segmentation, masks, merge…)
  // 'templates' = group selected roofs into a named, immutable client template
  // 'drafts'    = panel design workspace; each draft starts from a template
  activeTab: 'detect',

  // Saved roof groupings. A template is an immutable snapshot of one or more
  // detected roof planes belonging to a client. It is the BASE every draft
  // is forked from, and it cannot be deleted from the UI.
  // Shape: [{ id, name, createdAt, roofs: <deep-cloned roof array> }]
  templates: [],
  activeTemplateId: null,

  // Panel-design drafts. Each draft belongs to one template and stores the
  // panel placements + the settings used to generate them, so the client can
  // browse multiple proposals side-by-side under one template.
  // Shape: [{ id, templateId, name, createdAt,
  //           settings: { panelTypeIdx, panelScale, panelGap, panelAngleDeg, customPanel },
  //           panelsByRoof: { [roofId]: [{pos,quat,w,h}, …] } }]
  drafts: [],
  activeDraftId: null,
  // True while the user is editing a draft (either a freshly-forked "New
  // Draft" or a previously-saved one). Drives the right sidebar into the
  // draft-editor view AND re-shows the roof-detection action buttons +
  // overlays, so panels and roof tweaks live side-by-side under one tab.
  draftEditing: false,

  // Clipboard for the panel-recipe copy/paste action in the Drafts tab.
  // Stores just the *settings* (type / scale / gap / angle / custom-panel),
  // so the recipe re-generates a sensible layout for any target roof.
  panelClipboard: null,

  // Per-panel selection inside the draft sandbox. Keys are
  // "<roofId>#<panelIndex>" strings; the panel mesh turns green and the
  // toolbar exposes Delete + Copy actions.
  selectedPanelKeys: [],
  // Visibility + opacity of all panels (global toggle). When false, no
  // panel meshes are rendered at all. Opacity 0..1 controls how see-through
  // the panel boxes are when visible.
  panelsVisible: true,
  panelOpacity: 1,
  // Clipboard for an INDIVIDUAL panel (the "drag-and-drop" recipe). When
  // present, the user can enter mode='panel-drop' and click anywhere on
  // the building to drop a new panel with the same w/h/wp + in-plane angle,
  // automatically conforming to whatever roof surface they clicked.
  // Shape: { w, h, wp, angleDeg }
  singlePanelClipboard: null,

  debugOn: false,
  texturesOn: true,
  modelVisible: true,           // 3D building meshes visible (turn off to inspect masks only)
  smoothSurfaceOn: true,        // smooth shading for no-texture inspection mode
  smoothMask: true,             // Chaikin smoothing applied to extracted roof polygons
  clickSearchRadius: 40,        // metres: max half-extent of flood from a single click (no crop)
  selectedRoofIds: [],          // roofs ticked for batch operations (e.g. merge)
  meshSmoothLevel: 0,           // 0..1 surface smoothness (Taubin); 0 = original, 1 = max flattening
  polygonDraft: [],             // [{x,y,z}] user-clicked corner points being assembled into a polygon roof
  hud: {
    cameraPos: '–',
    cameraTarget: '–',
    modelBounds: '–',
    modelSize: '–',
    upTriangles: 0,
    cropRegion: 'none',
    clipPlanes: 0,
    roofCount: 0,
    activeRoof: 'none',
    lastHit: '–',
    lastNormal: '–',
    detectMsg: '–',
    autoOrient: '–',
  },

  hint: 'Pick a model to start',
});

export function useStore(selector) {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get())
  );
}
