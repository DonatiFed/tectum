'use client';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { store, useStore } from '../lib/store';
import { detectUpQuaternion, buildUpwardTriangles } from '../lib/autoOrient';
import { detectRoofPlane, detectRoofsInArea, generatePanelLayout, eraseStroke, eraseReset, eraseLasso, smoothMaskGrid, mergeRoofPlanes, roofFromPolygon } from '../lib/roof';
import { smoothMeshes, resetMeshSmoothing } from '../lib/meshSmooth';
import { PANEL_TYPES } from '../lib/catalog';
import { sunDirection, panelIrradiance, irradianceToHex } from '../lib/solar';

export default function Scene() {
  return (
    <Canvas
      gl={{ antialias: false, powerPreference: 'low-power', localClippingEnabled: true, preserveDrawingBuffer: true }}
      dpr={[1, 1.5]}
      camera={{ fov: 55, near: 0.1, far: 5000, position: [200, 200, 200] }}
      style={{ position: 'absolute', inset: 0, background: '#0d1b2a' }}
    >
      <ambientLight intensity={1.4} />
      <directionalLight position={[100, 200, 80]} intensity={1.6} color={'#fff5e0'} />
      <SceneContents />
    </Canvas>
  );
}

function SceneContents() {
  const { gl, camera, scene, raycaster } = useThree();
  const controlsRef = useRef();
  const modelRef = useRef();
  const upTrisRef = useRef([]);
  const modelBoxRef = useRef(null);
  const meshesRef = useRef([]);
  // Active camera tween: { startPos, endPos, startTarget, endTarget, startTime, duration }
  const camAnimRef = useRef(null);

  const selectedModel = useStore(s => s.selectedModel);
  const mode          = useStore(s => s.mode);
  const cropBounds    = useStore(s => s.cropBounds);
  const roofs         = useStore(s => s.roofs);
  const texturesOn    = useStore(s => s.texturesOn);
  const modelVisible  = useStore(s => s.modelVisible);
  const smoothSurfaceOn = useStore(s => s.smoothSurfaceOn);
  const meshSmoothLevel = useStore(s => s.meshSmoothLevel);
  const originalMaterialsRef = useRef(new Map());

  // ── Load the GLB whenever the user picks a different one
  useEffect(() => {
    if (!selectedModel) return;
    let cancelled = false;

    // Clean previous
    if (modelRef.current) {
      scene.remove(modelRef.current);
      modelRef.current.traverse(o => {
        if (o.geometry) o.geometry.dispose?.();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose?.());
      });
      modelRef.current = null;
    }
    upTrisRef.current = [];
    modelBoxRef.current = null;
    meshesRef.current = [];

    const draco = new DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/libs/draco/gltf/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    store.set({ loaded: false, loadProgress: 0, hint: `Loading ${selectedModel.name}…` });

    loader.load(
      selectedModel.file,
      (gltf) => {
        if (cancelled) return;
        const model = gltf.scene;

        // ── 1. Auto-orient: detect dominant up direction and rotate so +Y is up
        const orient = detectUpQuaternion(model);
        model.applyQuaternion(orient.quat);
        model.updateWorldMatrix(true, true);
        store.set(s => ({ hud: { ...s.hud, autoOrient: `dominant=${orient.dominant} sums=${JSON.stringify(orient.sums).slice(0, 90)}` } }));

        // ── 2. Centre & ground at y=0
        let box = new THREE.Box3().setFromObject(model);
        const ctr = box.getCenter(new THREE.Vector3());
        model.position.x -= ctr.x;
        model.position.z -= ctr.z;
        box = new THREE.Box3().setFromObject(model);
        model.position.y -= box.min.y;

        // ── 3. Auto-scale (longest horizontal extent → 200 units)
        box = new THREE.Box3().setFromObject(model);
        const sz = box.getSize(new THREE.Vector3());
        const horiz = Math.max(sz.x, sz.z);
        if (horiz > 0) {
          const s = 200 / horiz;
          model.scale.setScalar(s);
          model.position.multiplyScalar(s);
        }
        // Re-ground after scale
        box = new THREE.Box3().setFromObject(model);
        model.position.y -= box.min.y;
        modelBoxRef.current = new THREE.Box3().setFromObject(model);

        scene.add(model);
        modelRef.current = model;

        // Cache meshes for raycasting
        const meshes = [];
        model.traverse(o => { if (o.isMesh) meshes.push(o); });
        meshesRef.current = meshes;

        // ── 4. Pre-index upward-facing triangles
        upTrisRef.current = buildUpwardTriangles(model);

        // If we're resuming a saved project from the dashboard, restore
        // the previously detected roofs / saved templates / drafts AFTER
        // the GLB has loaded, instead of resetting them. The dashboard
        // sets `_resume` on the store right before flipping selectedModel.
        const resume = store.get()._resume;
        const orbitCt = modelBoxRef.current.getCenter(new THREE.Vector3());
        const orbitSz = modelBoxRef.current.getSize(new THREE.Vector3());
        store.set({
          loaded: true,
          loadProgress: 1,
          mode: 'orbit',
          cropBounds: null,
          roofs: resume?.roofs ?? [],
          activeRoofId: null,
          templates: resume?.templates ?? store.get().templates,
          drafts: resume?.drafts ?? store.get().drafts,
          activeTemplateId: resume?.activeTemplateId ?? null,
          activeDraftId: resume?.activeDraftId ?? null,
          _resume: null,
          hint: resume
            ? `Resumed project · ${(resume.roofs?.length ?? 0)} roof${(resume.roofs?.length ?? 0) === 1 ? '' : 's'}, ${(resume.templates?.length ?? 0)} template${(resume.templates?.length ?? 0) === 1 ? '' : 's'}`
            : `Loaded · ${upTrisRef.current.length.toLocaleString()} roof faces · auto-up=${orient.dominant}`,
          sunOrbitCenter: [orbitCt.x, 0, orbitCt.z],
          sunOrbitRadius: Math.max(orbitSz.x, orbitSz.z),
        });

        // Frame the model
        setTimeout(() => fitCameraToBox(camera, controlsRef.current, modelBoxRef.current, 'persp'), 50);
      },
      (xhr) => { if (!cancelled && xhr.total) store.set({ loadProgress: xhr.loaded / xhr.total }); },
      (err) => { console.error(err); store.set({ hint: 'Load failed: ' + err.message }); }
    );

    return () => { cancelled = true; };
  }, [selectedModel, scene, camera]);

  // ── Apply renderer clipping planes from cropBounds + draw helper
  useEffect(() => {
    if (!cropBounds) {
      gl.clippingPlanes = [];
      removeCropHelper(scene);
      store.set(s => ({ hud: { ...s.hud, clipPlanes: 0 } }));
      if (modelBoxRef.current) {
        const ct = modelBoxRef.current.getCenter(new THREE.Vector3());
        const sz = modelBoxRef.current.getSize(new THREE.Vector3());
        store.set({ sunOrbitCenter: [ct.x, 0, ct.z], sunOrbitRadius: Math.max(sz.x, sz.z) });
      }
      return;
    }
    const { minX, maxX, minZ, maxZ } = cropBounds;
    gl.clippingPlanes = [
      new THREE.Plane(new THREE.Vector3( 1, 0, 0), -minX),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0),  maxX),
      new THREE.Plane(new THREE.Vector3( 0, 0, 1), -minZ),
      new THREE.Plane(new THREE.Vector3( 0, 0,-1),  maxZ),
    ];
    drawCropHelper(scene, modelBoxRef.current, cropBounds);
    store.set(s => ({ hud: { ...s.hud, clipPlanes: 4, cropRegion: `[${minX.toFixed(0)},${minZ.toFixed(0)}]→[${maxX.toFixed(0)},${maxZ.toFixed(0)}]` } }));
    if (modelBoxRef.current) {
      const rbox = new THREE.Box3(
        new THREE.Vector3(minX, modelBoxRef.current.min.y, minZ),
        new THREE.Vector3(maxX, modelBoxRef.current.max.y, maxZ),
      );
      const ct = rbox.getCenter(new THREE.Vector3());
      const sz = rbox.getSize(new THREE.Vector3());
      store.set({ sunOrbitCenter: [ct.x, 0, ct.z], sunOrbitRadius: Math.max(sz.x, sz.z) });
    }
  }, [cropBounds, gl, scene]);

  // ── Snapshot the current scene at a fixed 45° view (used as the
  // dashboard card thumbnail). Caller passes a callback in event.detail.done.
  // We temporarily reposition the camera, render once, grab the JPEG data
  // URL, then restore the camera so the user doesn't notice.
  useEffect(() => {
    const onSnapshot = (e) => {
      const done = e.detail?.done;
      if (typeof done !== 'function') return;
      const box = modelBoxRef.current;
      if (!box) { done(null); return; }
      const ctr = box.getCenter(new THREE.Vector3());
      const sz  = box.getSize(new THREE.Vector3());
      // 45° elevation, 45° azimuth around the model. Project AABB corners
      // onto the camera plane to get a tight fit, then pull in slightly so
      // the dashboard thumbnail crops to the model rather than empty sky.
      const dir = new THREE.Vector3(1, 1, 1).normalize();
      const fovV = (camera.fov * Math.PI / 180);
      const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
      const fwd   = dir.clone().multiplyScalar(-1);
      const right = new THREE.Vector3(0, 1, 0).cross(fwd).normalize();
      const up    = fwd.clone().cross(right).normalize();
      let halfW = 0, halfH = 0;
      for (let xi = -1; xi <= 1; xi += 2)
      for (let yi = -1; yi <= 1; yi += 2)
      for (let zi = -1; zi <= 1; zi += 2) {
        const corner = new THREE.Vector3(
          xi * sz.x * 0.5,
          yi * sz.y * 0.5,
          zi * sz.z * 0.5,
        );
        halfW = Math.max(halfW, Math.abs(corner.dot(right)));
        halfH = Math.max(halfH, Math.abs(corner.dot(up)));
      }
      const distH = halfH / Math.tan(fovV / 2);
      const distW = halfW / Math.tan(fovH / 2);
      // 0.92 = ~8% zoom-in past the perfect fit so the model fills the card.
      const dist  = Math.max(distH, distW) * 0.92;
      const savedPos    = camera.position.clone();
      const savedTarget = controlsRef.current?.target.clone();
      camera.position.copy(ctr).addScaledVector(dir, dist);
      camera.lookAt(ctr);
      camera.updateProjectionMatrix();
      // Render once into the (preserved) drawing buffer, then grab pixels.
      gl.render(scene, camera);
      let url = null;
      try { url = gl.domElement.toDataURL('image/jpeg', 0.7); } catch (err) { console.warn('[snapshot] toDataURL failed:', err); }
      // Restore camera + controls so the user doesn't see the swing.
      camera.position.copy(savedPos);
      if (savedTarget && controlsRef.current) {
        controlsRef.current.target.copy(savedTarget);
        controlsRef.current.update();
      }
      gl.render(scene, camera);
      done(url);
    };
    window.addEventListener('project:snapshot', onSnapshot);
    return () => window.removeEventListener('project:snapshot', onSnapshot);
  }, [gl, camera, scene]);

  // ── Camera control event handlers
  useEffect(() => {
    const handlers = {
      'cam:zoom':   (e) => { camAnimRef.current = null; zoom(camera, controlsRef.current, e.detail); },
      'cam:reset':  () => { camAnimRef.current = null; fullReset(camera, controlsRef.current, modelBoxRef.current, gl, scene); },
      // "Top" smoothly tweens the camera to a true bird's-eye view
      // (looking straight down) around the current target/distance — no
      // reframe. Use the rotation pad to glide back from there.
      'cam:top':    () => animatePolar(camera, controlsRef.current, camAnimRef, 0.001),
      // "45°" tweens the polar (vertical) angle to 45° from straight up,
      // matching how "Top" animates without changing distance / target.
      'cam:persp':  () => animatePolar(camera, controlsRef.current, camAnimRef, Math.PI / 4),
      'cam:rotate': (e) => { camAnimRef.current = null; rotateOrbit(camera, controlsRef.current, e.detail); },
      // Cardinal preset: tween the camera azimuth to N / E / S / W while
      // keeping the current tilt + distance + target. Lets the user snap
      // between front / side / back views without re-framing.
      'cam:compass': (e) => {
        const map = { N: 0, E: Math.PI / 2, S: Math.PI, W: -Math.PI / 2 };
        const theta = map[e.detail];
        if (theta === undefined) return;
        animateAzimuth(camera, controlsRef.current, camAnimRef, theta);
      },
      'cam:pan':    (e) => { camAnimRef.current = null; panCamera(camera, controlsRef.current, e.detail); },
      'crop:apply': (e) => {
        const { x1, y1, x2, y2 } = e.detail;
        const bounds = screenRectToWorldBounds({ camera, raycaster, gl, modelBox: modelBoxRef.current, x1, y1, x2, y2 });
        if (!bounds) return;
        // Don't auto-realign or jump to select mode — just apply the crop
        // and hand control back to the navigator so the user can frame the
        // building themselves.
        store.set({ cropBounds: bounds, mode: 'orbit', hint: 'Crop applied · use the navigator to frame the building, then pick a Mode' });
      },
      'crop:clear': () => store.set({ cropBounds: null, hint: 'Crop cleared' }),
      'roof:deleteAt': (e) => {
        const meshes = meshesRef.current;
        const rect = gl.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((e.detail.x - rect.left) / rect.width) * 2 - 1,
          -((e.detail.y - rect.top) / rect.height) * 2 + 1
        );
        // Try to hit a roof-mask mesh first by raycasting against scene; the
        // visualised polygons are children of `scene`. Easiest: walk every
        // roof and test if the click point projects inside its polygon mask.
        raycaster.setFromCamera(ndc, camera);
        raycaster.far = 10000;
        const hits = raycaster.intersectObjects(meshes, false);
        const hitPt = hits.length ? hits[0].point.clone() : null;
        const s = store.get();
        if (!hitPt) {
          // Fallback: delete the active roof
          if (s.activeRoofId) {
            store.set(st => ({
              roofs: st.roofs.filter(r => r.id !== s.activeRoofId),
              activeRoofId: null,
              hint: `Deleted active roof ${s.activeRoofId}`,
            }));
          }
          return;
        }
        // Find the roof whose polygon mask contains the hit point
        let target = null;
        for (const r of s.roofs) {
          const p = r.plane;
          const d = hitPt.clone().sub(p.centre);
          const lu = d.dot(p.u), lv = d.dot(p.v);
          const dn = Math.abs(d.dot(p.normal));
          if (dn > 2.5) continue; // not on this plane
          if (Array.isArray(p.mask) && p.mask.length >= 3) {
            if (pointInPoly2D(lu, lv, p.mask)) { target = r; break; }
          } else if (Math.abs(lu) <= p.width/2 && Math.abs(lv) <= p.height/2) {
            target = r; break;
          }
        }
        if (!target) {
          store.set({ hint: 'Click missed all roof segments · drag a closed loop to lasso-erase instead' });
          return;
        }
        store.set(st => ({
          roofs: st.roofs.filter(r => r.id !== target.id),
          activeRoofId: st.activeRoofId === target.id ? null : st.activeRoofId,
          selectedRoofIds: (st.selectedRoofIds ?? []).filter(id => id !== target.id),
          hint: `Deleted ${target.id}`,
        }));
      },
      'mask:smooth': () => {
        const s = store.get();
        const roof = s.roofs.find(r => r.id === s.activeRoofId);
        if (!roof) { store.set({ hint: 'Select an active roof to smooth its mask' }); return; }
        smoothMaskGrid(roof.plane, 2);
        store.set(st => ({
          roofs: st.roofs.map(r => r.id === roof.id ? { ...r, plane: { ...roof.plane } } : r),
          hint: `Smoothed mask of ${roof.id} (gaps filled, edges rounded)`,
        }));
      },
      'erase:clear': () => {
        const s = store.get();
        const roof = s.roofs.find(r => r.id === s.activeRoofId);
        if (!roof) return;
        eraseReset(roof.plane);
        store.set(st => ({
          roofs: st.roofs.map(r => r.id === roof.id ? { ...r, plane: { ...roof.plane } } : r),
          hint: 'Erase reset · roof restored to detected outline',
        }));
      },
      // Drag a stroke across one or more roof outlines → delete every roof
      // whose polygon edge is intersected by any stroke segment.
      'roof:deleteByEdgeCross': (e) => {
        const pts = e.detail.points;
        if (!pts || pts.length < 2) return;
        const rect = gl.domElement.getBoundingClientRect();
        // Convert stroke client coords to canvas-pixel coords
        const stroke = pts.map(([x, y]) => [x - rect.left, y - rect.top]);
        const W = rect.width, H = rect.height;
        const projV = new THREE.Vector3();
        const ndcToPx = (v) => [
          ( v.x * 0.5 + 0.5) * W,
          (-v.y * 0.5 + 0.5) * H,
        ];
        const s = store.get();
        const toDelete = new Set();
        for (const r of s.roofs) {
          const p = r.plane;
          const poly = (Array.isArray(p.mask) && p.mask.length >= 3)
            ? p.mask
            : [
                [-p.width/2, -p.height/2],
                [ p.width/2, -p.height/2],
                [ p.width/2,  p.height/2],
                [-p.width/2,  p.height/2],
              ];
          // Project polygon vertices to screen pixels (skip points behind cam)
          const screenPoly = [];
          let allOnscreen = true;
          for (const [lu, lv] of poly) {
            projV.copy(p.centre)
              .addScaledVector(p.u, lu)
              .addScaledVector(p.v, lv)
              .project(camera);
            if (projV.z < -1 || projV.z > 1) { allOnscreen = false; }
            screenPoly.push(ndcToPx(projV));
          }
          if (!screenPoly.length || !allOnscreen) continue;
          // Test every stroke segment against every polygon edge
          let crossed = false;
          for (let i = 1; i < stroke.length && !crossed; i++) {
            const a = stroke[i-1], b = stroke[i];
            for (let j = 0, k = screenPoly.length - 1; j < screenPoly.length; k = j++) {
              if (segmentsIntersect2D(a, b, screenPoly[k], screenPoly[j])) {
                crossed = true; break;
              }
            }
          }
          if (crossed) toDelete.add(r.id);
        }
        if (!toDelete.size) {
          store.set({ hint: 'Stroke didn\'t cross any roof outline · drag across an edge to delete' });
          return;
        }
        store.set(st => ({
          roofs: st.roofs.filter(r => !toDelete.has(r.id)),
          activeRoofId: toDelete.has(st.activeRoofId) ? null : st.activeRoofId,
          selectedRoofIds: (st.selectedRoofIds ?? []).filter(id => !toDelete.has(id)),
          hint: `Erased ${toDelete.size} roof${toDelete.size>1?'s':''} crossed by stroke`,
        }));
      },
      // Drag a rectangle across the canvas in Pick mode → mark every roof
      // whose polygon overlaps the rect as selected (so the floating action
      // bar can merge / delete / keep-only on the batch).
      'roofs:pickInRect': (e) => {
        const { x1, y1, x2, y2, additive } = e.detail;
        const rect = gl.domElement.getBoundingClientRect();
        const rx1 = Math.min(x1, x2) - rect.left;
        const ry1 = Math.min(y1, y2) - rect.top;
        const rx2 = Math.max(x1, x2) - rect.left;
        const ry2 = Math.max(y1, y2) - rect.top;
        const W = rect.width, H = rect.height;
        const projV = new THREE.Vector3();
        const ndcToPx = (v) => [( v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H];
        const inRect = ([px, py]) => px >= rx1 && px <= rx2 && py >= ry1 && py <= ry2;
        const rectEdges = [
          [[rx1, ry1], [rx2, ry1]],
          [[rx2, ry1], [rx2, ry2]],
          [[rx2, ry2], [rx1, ry2]],
          [[rx1, ry2], [rx1, ry1]],
        ];
        const s = store.get();
        const picked = [];
        for (const r of s.roofs) {
          const p = r.plane;
          const poly = (Array.isArray(p.mask) && p.mask.length >= 3)
            ? p.mask
            : [
                [-p.width/2, -p.height/2],
                [ p.width/2, -p.height/2],
                [ p.width/2,  p.height/2],
                [-p.width/2,  p.height/2],
              ];
          const screenPoly = [];
          let allOnscreen = true;
          for (const [lu, lv] of poly) {
            projV.copy(p.centre)
              .addScaledVector(p.u, lu)
              .addScaledVector(p.v, lv)
              .project(camera);
            if (projV.z < -1 || projV.z > 1) allOnscreen = false;
            screenPoly.push(ndcToPx(projV));
          }
          if (!screenPoly.length || !allOnscreen) continue;
          // Hit if: any polygon vertex is inside the rect, OR any polygon
          // edge crosses any rect edge, OR the rect's centre is inside the
          // polygon (handles fully-enclosed-by-roof case).
          let hit = screenPoly.some(inRect);
          if (!hit) {
            outer: for (let i = 0, j = screenPoly.length - 1; i < screenPoly.length; j = i++) {
              for (const [a, b] of rectEdges) {
                if (segmentsIntersect2D(screenPoly[j], screenPoly[i], a, b)) { hit = true; break outer; }
              }
            }
          }
          if (!hit) {
            const cx = (rx1 + rx2) / 2, cy = (ry1 + ry2) / 2;
            if (pointInPoly2D(cx, cy, screenPoly)) hit = true;
          }
          if (hit) picked.push(r.id);
        }
        const prev = additive ? (s.selectedRoofIds ?? []) : [];
        const next = Array.from(new Set([...prev, ...picked]));
        store.set({
          selectedRoofIds: next,
          hint: picked.length
            ? `Picked ${picked.length} roof${picked.length===1?'':'s'} \u00b7 ${next.length} selected total`
            : 'Rectangle didn\'t cover any roof outlines',
        });
      },
    };
    Object.entries(handlers).forEach(([n, h]) => window.addEventListener(n, h));
    return () => Object.entries(handlers).forEach(([n, h]) => window.removeEventListener(n, h));
  }, [camera, gl, scene, raycaster]);

  // ── Click / drag-area handlers for roof detection (driven by SelectOverlay)
  useEffect(() => {
    const detectAtScreen = (sx, sy) => {
      const meshes = meshesRef.current;
      if (!meshes.length) return;
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((sx - rect.left) / rect.width) * 2 - 1,
        -((sy - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      raycaster.far = 10000;
      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) {
        store.set({ hint: 'Click missed all geometry' });
        return;
      }
      const hit = hits[0];
      const seedNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      const seedPoint  = hit.point.clone();

      store.set(s => ({ hud: {
        ...s.hud,
        lastHit:    `${seedPoint.x.toFixed(1)}, ${seedPoint.y.toFixed(1)}, ${seedPoint.z.toFixed(1)}`,
        lastNormal: `${seedNormal.x.toFixed(2)}, ${seedNormal.y.toFixed(2)}, ${seedNormal.z.toFixed(2)}`,
      } }));

      if (seedNormal.y < 0.20) {
        const msg = `normal.y=${seedNormal.y.toFixed(2)} too steep · click a flatter spot`;
        store.set(s => ({ hint: msg, hud: { ...s.hud, detectMsg: msg } }));
        return;
      }

      const stateNow = store.get();
      const activeRoof = stateNow.roofs.find(r => r.id === stateNow.activeRoofId);
      const shouldMerge = stateNow.mergeIntoActive && activeRoof &&
        compatiblePlane(activeRoof.plane, seedPoint, seedNormal);

      const result = detectRoofPlane({
        upTriangles: upTrisRef.current,
        seedPoint,
        seedNormal: shouldMerge ? activeRoof.plane.normal : seedNormal,
        cropBounds: stateNow.cropBounds,
        localRadius: stateNow.clickSearchRadius,
        groundY: modelBoxRef.current?.min.y ?? null,
      });

      if (!result.ok) {
        store.set(s => ({ hint: `Detection failed: ${result.reason}`, hud: { ...s.hud, detectMsg: result.reason } }));
        return;
      }

      if (shouldMerge) {
        store.set(s => ({
          roofs: s.roofs.map(r => r.id === activeRoof.id
            ? { ...r, plane: result.plane, panels: [] }
            : r),
          hint: `Extended ${activeRoof.id}: ${result.plane.width.toFixed(1)}×${result.plane.height.toFixed(1)} m · cluster ${result.plane.clusterSize}`,
          hud: { ...s.hud, detectMsg: `MERGED · cluster=${result.plane.clusterSize}` },
        }));
        return;
      }

      const id = 'roof-' + Date.now().toString(36);
      const newRoof = { id, plane: result.plane, panels: [], erased: [] };
      store.set(s => ({
        roofs: [...s.roofs, newRoof],
        activeRoofId: id,
        hint: `${id}: ${result.plane.width.toFixed(1)}×${result.plane.height.toFixed(1)} m · cluster ${result.plane.clusterSize}`,
        hud: { ...s.hud, detectMsg: `NEW · cluster=${result.plane.clusterSize}` },
      }));
    };

    const onPoint = (e) => detectAtScreen(e.detail.x, e.detail.y);
    const onArea  = (e) => {
      const { x1, y1, x2, y2 } = e.detail;
      const bounds = screenRectToWorldBounds({ camera, raycaster, gl, modelBox: modelBoxRef.current, x1, y1, x2, y2 });
      // Build a screen-space predicate so the user's drag rectangle truly
      // matches what's under the cursor — not just where the screen rect
      // happens to intersect the y=midY ground plane (that drifts wildly on
      // tall buildings under angled cameras).
      const rect = gl.domElement.getBoundingClientRect();
      const ndcMinX = (Math.min(x1, x2) - rect.left) / rect.width  *  2 - 1;
      const ndcMaxX = (Math.max(x1, x2) - rect.left) / rect.width  *  2 - 1;
      const ndcMinY = -((Math.max(y1, y2) - rect.top) / rect.height *  2 - 1);
      const ndcMaxY = -((Math.min(y1, y2) - rect.top) / rect.height *  2 - 1);
      const projV = new THREE.Vector3();
      const screenTest = (t) => {
        projV.set(t.cx, t.cy, t.cz).project(camera);
        return projV.x >= ndcMinX && projV.x <= ndcMaxX &&
               projV.y >= ndcMinY && projV.y <= ndcMaxY &&
               projV.z >= -1 && projV.z <= 1;
      };
      // If world-bounds projection failed (very steep camera), still run
      // detection using the screen-space filter alone.
      const result = detectRoofsInArea({
        upTriangles: upTrisRef.current,
        areaBounds: bounds,
        triangleFilter: screenTest,
        groundY: modelBoxRef.current?.min.y ?? null,
      });
      if (!result.ok || !result.planes.length) {
        store.set(s => ({ hint: `No roofs found in area (${result.stats?.clusters ?? 0} clusters)`, hud: { ...s.hud, detectMsg: 'no clusters' } }));
        return;
      }
      const newRoofs = result.planes.map((plane, i) => ({
        id: 'roof-' + Date.now().toString(36) + '-' + i,
        plane, panels: [], erased: [],
      }));
      store.set(s => ({
        roofs: [...s.roofs, ...newRoofs],
        activeRoofId: newRoofs[0].id,
        hint: `Detected ${newRoofs.length} continuous plane${newRoofs.length>1?'s':''} (${result.stats.clusters} clusters scanned)`,
        hud: { ...s.hud, detectMsg: `AREA · kept=${result.stats.kept}/${result.stats.clusters}` },
      }));
    };

    window.addEventListener('roof:detectPoint', onPoint);
    window.addEventListener('roof:detectArea',  onArea);

    // ── Polygon roof — user clicks corners; we raycast each click into 3D
    //    space against the model meshes, accumulate world points, and on
    //    finish build a plane directly from those corners.
    const onPolygonAdd = (e) => {
      const meshes = meshesRef.current;
      if (!meshes.length) return;
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.detail.x - rect.left) / rect.width) * 2 - 1,
        -((e.detail.y - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      raycaster.far = 10000;
      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) {
        store.set({ hint: 'Polygon click missed the model · click on the building surface' });
        return;
      }
      const p = hits[0].point;
      store.set(s => ({
        polygonDraft: [...(s.polygonDraft ?? []), { x: p.x, y: p.y, z: p.z }],
        hint: `Polygon corner #${(s.polygonDraft?.length ?? 0) + 1} placed · keep clicking corners · double-click or press Finish to close`,
      }));
    };
    const onPolygonUndo = () => {
      store.set(s => {
        const next = (s.polygonDraft ?? []).slice(0, -1);
        return { polygonDraft: next, hint: next.length ? `Removed last corner · ${next.length} remain` : 'Polygon empty · click corners on the model' };
      });
    };
    const onPolygonCancel = () => {
      store.set({ polygonDraft: [], hint: 'Polygon cancelled' });
    };
    const onPolygonFinish = () => {
      const draft = store.get().polygonDraft ?? [];
      if (draft.length < 3) {
        store.set({ hint: `Need at least 3 corners (have ${draft.length})` });
        return;
      }
      const pts = draft.map(p => new THREE.Vector3(p.x, p.y, p.z));
      const result = roofFromPolygon(pts);
      if (!result.ok) {
        store.set({ hint: `Polygon roof failed: ${result.reason}` });
        return;
      }
      const id = 'roof-poly-' + Date.now().toString(36);
      const newRoof = { id, plane: result.plane, panels: [], erased: [] };
      store.set(s => ({
        roofs: [...s.roofs, newRoof],
        activeRoofId: id,
        polygonDraft: [],
        mode: 'orbit',
        hint: `${id}: user-drawn polygon · ${result.plane.width.toFixed(1)}×${result.plane.height.toFixed(1)} m · ${draft.length} corners`,
      }));
    };
    window.addEventListener('polygon:addPoint', onPolygonAdd);
    window.addEventListener('polygon:undo',     onPolygonUndo);
    window.addEventListener('polygon:cancel',   onPolygonCancel);
    window.addEventListener('polygon:finish',   onPolygonFinish);

    return () => {
      window.removeEventListener('roof:detectPoint', onPoint);
      window.removeEventListener('roof:detectArea',  onArea);
      window.removeEventListener('polygon:addPoint', onPolygonAdd);
      window.removeEventListener('polygon:undo',     onPolygonUndo);
      window.removeEventListener('polygon:cancel',   onPolygonCancel);
      window.removeEventListener('polygon:finish',   onPolygonFinish);
    };
  }, [gl, camera, raycaster]);

  // ── Listen for "place panels" / "clear panels" requests for active roof
  useEffect(() => {
    const onPlace = () => {
      const s = store.get();
      // If the user has multi-selected roofs, place on every one of them;
      // otherwise just on the active roof. This keeps the Drafts tab snappy
      // when you want to "fill these 4 roofs with this layout".
      const ids = (s.selectedRoofIds && s.selectedRoofIds.length)
        ? s.selectedRoofIds
        : (s.activeRoofId ? [s.activeRoofId] : []);
      const targets = s.roofs.filter(r => ids.includes(r.id));
      if (!targets.length) { store.set({ hint: 'Pick a roof first' }); return; }
      const panelType = s.panelTypeIdx === -1
        ? { ...s.customPanel }
        : PANEL_TYPES[s.panelTypeIdx];
      // Build a serialisable spec so each roof remembers which panel type was used.
      const panelSpec = {
        typeIdx:    s.panelTypeIdx,
        brand:      panelType.brand  ?? (s.panelTypeIdx === -1 ? 'Custom' : '—'),
        model:      panelType.model  ?? '',
        id:         panelType.id     ?? 'custom',
        w: panelType.w, h: panelType.h, wp: panelType.wp,
        efficiency: panelType.efficiency ?? (panelType.wp / (1000 * panelType.w * panelType.h) * 100),
        datasheetUrl: panelType.datasheetUrl ?? null,
      };
      const rc = new THREE.Raycaster();
      let totalPanels = 0;
      const updated = new Map();
      let lastAngle = s.panelAngleDeg;
      for (const roof of targets) {
        const { placements, angleDeg } = generatePanelLayout({
          plane: roof.plane, panelType,
          scale: s.panelScale, gap: s.panelGap,
          angleDeg: s.panelAngleDeg,
          autoAlign: s.panelAutoAlign,
          surfaceOffset: s.panelSurfaceOffset,
          landscape: s.panelLandscape,
          tiltDeg: s.panelTiltDeg,
          raycaster: rc, meshes: meshesRef.current,
        });
        updated.set(roof.id, placements);
        totalPanels += placements.length;
        lastAngle = angleDeg;
      }
      const angleNote = s.panelAutoAlign
        ? `slope-aligned + ${s.panelAngleDeg >= 0 ? '+' : ''}${s.panelAngleDeg.toFixed(0)}° on roof normal`
        : `${s.panelAngleDeg >= 0 ? '+' : ''}${s.panelAngleDeg.toFixed(0)}° on roof normal`;
      store.set(st => ({
        roofs: st.roofs.map(r => updated.has(r.id)
          ? { ...r, panels: updated.get(r.id), panelSpec }
          : r),
        hint: `Placed ${totalPanels} panels on ${targets.length} roof${targets.length===1?'':'s'} · ${angleNote}`,
      }));
    };
    const onClear = () => {
      const s = store.get();
      const ids = (s.selectedRoofIds && s.selectedRoofIds.length)
        ? s.selectedRoofIds
        : (s.activeRoofId ? [s.activeRoofId] : []);
      if (!ids.length) { store.set({ hint: 'Pick a roof first' }); return; }
      store.set(st => ({
        roofs: st.roofs.map(r => ids.includes(r.id) ? { ...r, panels: [] } : r),
        hint: `Cleared panels on ${ids.length} roof${ids.length===1?'':'s'}`,
      }));
    };
    const onClearAll = () => store.set({ roofs: [], activeRoofId: null, selectedRoofIds: [], hint: 'All roofs & panels cleared' });
    // Wipe everything currently in the scene back to a blank workspace —
    // detected roofs, panels, selection, active template/draft pointers,
    // crop region, mode. Saved templates + drafts in the store remain
    // intact (they're the persistent library).
    const onWorkspaceClear = () => {
      store.set({
        roofs: [], activeRoofId: null, selectedRoofIds: [],
        activeTemplateId: null, activeDraftId: null, draftEditing: false,
        cropBounds: null, mode: 'orbit', polygonDraft: [],
        hint: 'Workspace cleared · saved templates & drafts are still in the library',
      });
    };
    const onDeleteSelected = () => {
      const s = store.get();
      const ids = s.selectedRoofIds ?? [];
      if (!ids.length) return;
      store.set(st => ({
        roofs: st.roofs.filter(r => !ids.includes(r.id)),
        activeRoofId: ids.includes(st.activeRoofId) ? null : st.activeRoofId,
        selectedRoofIds: [],
        hint: `Deleted ${ids.length} roof${ids.length===1?'':'s'}`,
      }));
    };
    // Inverse of deleteSelected: drop every roof that is NOT selected.
    const onKeepSelected = () => {
      const s = store.get();
      const ids = s.selectedRoofIds ?? [];
      if (!ids.length) { store.set({ hint: 'Shift-click roofs first to mark them, then keep only those' }); return; }
      const removed = s.roofs.length - ids.length;
      if (removed <= 0) { store.set({ hint: 'Nothing to delete — every roof is already selected' }); return; }
      store.set(st => ({
        roofs: st.roofs.filter(r => ids.includes(r.id)),
        activeRoofId: ids.includes(st.activeRoofId) ? st.activeRoofId : (ids[0] ?? null),
        selectedRoofIds: [],
        hint: `Kept ${ids.length} selected · deleted ${removed} other${removed===1?'':'s'}`,
      }));
    };
    const onMerge = () => {
      const s = store.get();
      const ids = s.selectedRoofIds ?? [];
      const picks = s.roofs.filter(r => ids.includes(r.id));
      if (picks.length < 2) { store.set({ hint: 'Tick at least 2 roofs to merge' }); return; }
      const result = mergeRoofPlanes(picks.map(r => r.plane));
      if (!result.ok) { store.set({ hint: 'Merge failed: ' + result.reason }); return; }
      const id = 'roof-merged-' + Date.now().toString(36);
      const merged = { id, plane: result.plane, panels: [], erased: [] };
      store.set(st => ({
        roofs: [...st.roofs.filter(r => !ids.includes(r.id)), merged],
        activeRoofId: id,
        selectedRoofIds: [],
        hint: `Merged ${picks.length} roofs \u2192 ${result.plane.width.toFixed(1)}\u00d7${result.plane.height.toFixed(1)} m unified mask`,
      }));
    };
    window.addEventListener('panels:place', onPlace);
    window.addEventListener('panels:clear', onClear);
    window.addEventListener('roofs:clearAll', onClearAll);
    window.addEventListener('workspace:clear', onWorkspaceClear);
    window.addEventListener('roofs:deleteSelected', onDeleteSelected);
    window.addEventListener('roofs:keepSelected', onKeepSelected);
    window.addEventListener('roofs:merge', onMerge);
    // ── Templates / Drafts / panel-clipboard wiring ────────────────────
    // Detail payloads are deliberately tiny — IDs and names — so they keep
    // playing nicely with the existing CustomEvent bus.
    const onPanelsCopy = () => {
      const s = store.get();
      store.set({
        panelClipboard: {
          panelTypeIdx: s.panelTypeIdx,
          panelScale:   s.panelScale,
          panelGap:     s.panelGap,
          panelAngleDeg: s.panelAngleDeg,
          panelAutoAlign: s.panelAutoAlign,
          panelSurfaceOffset: s.panelSurfaceOffset,
          panelLandscape: s.panelLandscape,
          panelTiltDeg:   s.panelTiltDeg,
          customPanel:  { ...s.customPanel },
        },
        hint: 'Panel recipe copied · open another roof and click Paste',
      });
    };
    const onPanelsPaste = () => {
      const s = store.get();
      const c = s.panelClipboard;
      if (!c) { store.set({ hint: 'Clipboard empty — copy a panel layout first' }); return; }
      // Apply the clipboard SETTINGS as the live settings, then trigger a
      // normal place. The recipe re-generates a sensible grid for whatever
      // the destination plane looks like.
      store.set({
        panelTypeIdx: c.panelTypeIdx,
        panelScale:   c.panelScale,
        panelGap:     c.panelGap,
        panelAngleDeg: c.panelAngleDeg ?? 0,
        ...(c.panelAutoAlign     !== undefined ? { panelAutoAlign:     c.panelAutoAlign }     : {}),
        ...(c.panelSurfaceOffset !== undefined ? { panelSurfaceOffset: c.panelSurfaceOffset } : {}),
        ...(c.panelLandscape     !== undefined ? { panelLandscape:     c.panelLandscape }     : {}),
        ...(c.panelTiltDeg       !== undefined ? { panelTiltDeg:       c.panelTiltDeg }       : {}),
        ...(c.customPanel ? { customPanel: { ...c.customPanel } } : {}),
      });
      onPlace();
    };
    const onTemplateSave = (e) => {
      const name = (e?.detail?.name || '').trim() || `Template ${store.get().templates.length + 1}`;
      const s = store.get();
      // Snapshot the currently selected roofs (or every roof if no selection).
      const ids = (s.selectedRoofIds && s.selectedRoofIds.length)
        ? s.selectedRoofIds
        : s.roofs.map(r => r.id);
      const subset = s.roofs.filter(r => ids.includes(r.id));
      if (!subset.length) { store.set({ hint: 'Detect at least one roof before saving a template' }); return; }
      const id = 'tpl-' + Date.now().toString(36);
      // Deep-clone so future edits to the live roofs don't mutate the template.
      const snapshot = subset.map(r => cloneRoofForTemplate(r));
      store.set(st => ({
        templates: [...st.templates, { id, name, createdAt: Date.now(), roofs: snapshot }],
        activeTemplateId: id,
        hint: `Saved template "${name}" (${snapshot.length} roof${snapshot.length===1?'':'s'}) · base is locked, fork drafts in the Drafts tab`,
      }));
    };
    const onTemplateLoad = (e) => {
      const id = e?.detail?.id;
      const s = store.get();
      const tpl = s.templates.find(t => t.id === id);
      if (!tpl) return;
      // Replace the live roofs with a fresh clone of the template (no panels).
      const fresh = tpl.roofs.map(r => ({ ...cloneRoofForTemplate(r), panels: [] }));
      store.set({
        roofs: fresh,
        activeRoofId: fresh[0]?.id ?? null,
        selectedRoofIds: [],
        activeTemplateId: id,
        activeDraftId: null,
        draftEditing: false,
        hint: `Loaded template "${tpl.name}" — expand it to open or fork a draft`,
      });
    };
    const onDraftSave = (e) => {
      const name = (e?.detail?.name || '').trim();
      const s = store.get();
      if (!s.activeTemplateId) { store.set({ hint: 'Pick a template first, then save a draft' }); return; }
      // Snapshot panels + per-roof panel spec + global settings.
      const panelsByRoof    = {};
      const panelSpecByRoof = {};
      for (const r of s.roofs) {
        panelsByRoof[r.id]    = (r.panels ?? []).map(clonePanel);
        panelSpecByRoof[r.id] = r.panelSpec ?? null;
      }
      const settings = {
        panelTypeIdx: s.panelTypeIdx, panelScale: s.panelScale,
        panelGap: s.panelGap, panelAngleDeg: s.panelAngleDeg,
        panelAutoAlign: s.panelAutoAlign,
        panelSurfaceOffset: s.panelSurfaceOffset,
        panelLandscape: s.panelLandscape,
        panelTiltDeg:   s.panelTiltDeg,
        customPanel: { ...s.customPanel },
      };
      // If there's already an active draft, treat this as an autosave/update
      // instead of pushing a brand-new draft entry.
      if (s.activeDraftId && s.drafts.some(d => d.id === s.activeDraftId)) {
        store.set(st => ({
          drafts: st.drafts.map(d => d.id === st.activeDraftId
            ? { ...d, name: name || d.name, settings, panelsByRoof, panelSpecByRoof, updatedAt: Date.now() }
            : d
          ),
          hint: `Saved draft updates`,
        }));
        return;
      }
      const id = 'draft-' + Date.now().toString(36);
      const draft = {
        id,
        templateId: s.activeTemplateId,
        name: name || `Draft ${s.drafts.filter(d => d.templateId === s.activeTemplateId).length + 1}`,
        createdAt: Date.now(),
        settings,
        panelsByRoof,
        panelSpecByRoof,
      };
      store.set(st => ({
        drafts: [...st.drafts, draft],
        activeDraftId: id,
        hint: `Saved "${draft.name}" — switch drafts to compare proposals`,
      }));
    };
    const onDraftLoad = (e) => {
      const id = e?.detail?.id;
      const s = store.get();
      const draft = s.drafts.find(d => d.id === id);
      if (!draft) return;
      const tpl = s.templates.find(t => t.id === draft.templateId);
      if (!tpl) { store.set({ hint: 'Template behind this draft is missing' }); return; }
      // Rebuild live roofs from the template, then re-attach the draft's panels + spec.
      const fresh = tpl.roofs.map(r => {
        const cloned = cloneRoofForTemplate(r);
        cloned.panels    = (draft.panelsByRoof?.[r.id]    ?? []).map(clonePanel);
        cloned.panelSpec = draft.panelSpecByRoof?.[r.id]  ?? cloned.panelSpec ?? null;
        return cloned;
      });
      store.set({
        roofs: fresh,
        activeRoofId: fresh[0]?.id ?? null,
        selectedRoofIds: [],
        activeTemplateId: tpl.id,
        activeDraftId: id,
        draftEditing: true,
        ...draft.settings,
        hint: `Editing draft "${draft.name}" (${tpl.name})`,
      });
    };
    // "+ New Draft" — fork the template fresh (no draft id, no panels) and
    // flip into edit mode so the bottom controls + overlays appear.
    const onDraftNew = (e) => {
      const id = e?.detail?.templateId;
      const s = store.get();
      const tpl = s.templates.find(t => t.id === id) ?? s.templates.find(t => t.id === s.activeTemplateId);
      if (!tpl) { store.set({ hint: 'Pick a template first' }); return; }
      const fresh = tpl.roofs.map(r => ({ ...cloneRoofForTemplate(r), panels: [] }));
      store.set({
        roofs: fresh,
        activeRoofId: fresh[0]?.id ?? null,
        selectedRoofIds: [],
        activeTemplateId: tpl.id,
        activeDraftId: null,
        draftEditing: true,
        hint: `New draft on "${tpl.name}" — place panels, then Save as draft`,
      });
    };
    // Close the draft editor and return to the template overview list.
    const onDraftClose = () => {
      store.set({ draftEditing: false, hint: 'Closed draft editor' });
    };
    const onDraftDelete = (e) => {
      const id = e?.detail?.id;
      store.set(st => ({
        drafts: st.drafts.filter(d => d.id !== id),
        activeDraftId: st.activeDraftId === id ? null : st.activeDraftId,
        hint: 'Draft deleted',
      }));
    };
    // Delete a template and every draft forked from it. If the active draft
    // belonged to that template, exit the editor too.
    const onTemplateDelete = (e) => {
      const id = e?.detail?.id;
      store.set(st => {
        const droppedDrafts = st.drafts.filter(d => d.templateId === id).map(d => d.id);
        return {
          templates: st.templates.filter(t => t.id !== id),
          drafts:    st.drafts.filter(d => d.templateId !== id),
          activeTemplateId: st.activeTemplateId === id ? null : st.activeTemplateId,
          activeDraftId:    droppedDrafts.includes(st.activeDraftId) ? null : st.activeDraftId,
          draftEditing:     droppedDrafts.includes(st.activeDraftId) ? false : st.draftEditing,
          hint: `Template deleted${droppedDrafts.length ? ` (${droppedDrafts.length} draft${droppedDrafts.length===1?'':'s'} removed)` : ''}`,
        };
      });
    };
    window.addEventListener('panels:copy',  onPanelsCopy);
    window.addEventListener('panels:paste', onPanelsPaste);
    // ── Single-panel sandbox ─────────────────────────────────────────
    // Click-to-select panels, delete the selection, copy ONE panel as a
    // drop-recipe, then click anywhere on the building to drop more
    // panels with the same dimensions + in-plane angle.
    const keyOf = (roofId, index) => `${roofId}#${index}`;
    const parseKey = (k) => { const [roofId, idx] = k.split('#'); return { roofId, index: +idx }; };
    const onPanelSelect = (e) => {
      const { roofId, index, shift } = e.detail;
      const k = keyOf(roofId, index);
      store.set(s => {
        const has = s.selectedPanelKeys.includes(k);
        const next = shift
          ? (has ? s.selectedPanelKeys.filter(x => x !== k) : [...s.selectedPanelKeys, k])
          : (has && s.selectedPanelKeys.length === 1 ? [] : [k]);
        return {
          selectedPanelKeys: next,
          hint: next.length
            ? `${next.length} panel${next.length===1?'':'s'} selected · Delete or Copy in the side panel`
            : 'Panel deselected',
        };
      });
    };
    const onPanelDeleteSelected = () => {
      const s = store.get();
      if (!s.selectedPanelKeys.length) { store.set({ hint: 'No panels selected' }); return; }
      // Group indices by roof, sort desc so splices don't shift earlier indices
      const byRoof = new Map();
      for (const k of s.selectedPanelKeys) {
        const { roofId, index } = parseKey(k);
        if (!byRoof.has(roofId)) byRoof.set(roofId, []);
        byRoof.get(roofId).push(index);
      }
      let removed = 0;
      const nextRoofs = s.roofs.map(r => {
        const drop = byRoof.get(r.id);
        if (!drop) return r;
        const set = new Set(drop);
        const kept = (r.panels ?? []).filter((_, i) => !set.has(i));
        removed += (r.panels?.length ?? 0) - kept.length;
        return { ...r, panels: kept };
      });
      store.set({
        roofs: nextRoofs,
        selectedPanelKeys: [],
        hint: `Deleted ${removed} panel${removed===1?'':'s'}`,
      });
    };
    const onPanelCopySelected = () => {
      const s = store.get();
      const k = s.selectedPanelKeys[0];
      if (!k) { store.set({ hint: 'Select a panel first, then Copy' }); return; }
      const { roofId, index } = parseKey(k);
      const roof = s.roofs.find(r => r.id === roofId);
      const p = roof?.panels?.[index];
      if (!p) return;
      // Recipe stores intrinsic panel size + the current in-plane angle.
      // Surface conformity is recomputed at drop time using the host plane.
      const wp = (s.panelTypeIdx === -1 ? s.customPanel : PANEL_TYPES[s.panelTypeIdx])?.wp ?? 0;
      store.set({
        singlePanelClipboard: { w: p.w, h: p.h, wp, angleDeg: s.panelAngleDeg },
        hint: 'Panel copied · click "Drop new panel" then click on the building',
      });
    };
    const onPanelEnterDropMode = () => {
      const s = store.get();
      if (!s.singlePanelClipboard) { store.set({ hint: 'Copy a panel first, then drop' }); return; }
      store.set({ mode: 'panel-drop', selectedPanelKeys: [], hint: 'Click on the building to drop a panel · Esc to stop' });
    };
    const onPanelExitDropMode = () => {
      if (store.get().mode === 'panel-drop') store.set({ mode: 'orbit', hint: 'Drop mode off' });
    };
    // Rotate the currently-selected single panel by `delta` degrees around
    // its host roof's plane normal. Quaternion math: q_new = q_axis * q_current
    // applies the rotation in world space, which visually spins the panel
    // on the roof.
    const onPanelRotate = (e) => {
      const delta = +(e?.detail?.delta ?? 0);
      if (!delta) return;
      const s = store.get();
      const k = s.selectedPanelKeys[0];
      if (!k) return;
      const [roofId, idxStr] = k.split('#');
      const index = +idxStr;
      const roof = s.roofs.find(r => r.id === roofId);
      const panel = roof?.panels?.[index];
      if (!panel) return;
      const n = roof.plane.normal || {};
      const axis = new THREE.Vector3(n.x ?? 0, n.y ?? 1, n.z ?? 0).normalize();
      const dq = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(delta));
      const q  = panel.quat || {};
      const cur = new THREE.Quaternion(q.x ?? 0, q.y ?? 0, q.z ?? 0, q.w ?? 1);
      const next = dq.multiply(cur);
      store.set(st => ({
        roofs: st.roofs.map(r => r.id !== roofId ? r : ({
          ...r,
          panels: r.panels.map((p, i) => i !== index ? p : ({
            ...p,
            quat: { x: next.x, y: next.y, z: next.z, w: next.w },
          })),
        })),
        hint: `Rotated panel ${delta > 0 ? '+' : ''}${delta.toFixed(0)}°`,
      }));
    };
    // Drag-to-move a panel inside its host roof plane. The pointer is
    // intersected with an infinite plane parallel to the roof, passing
    // through the panel's current height — that keeps the panel coplanar
    // with the rest of the layout while it slides under the cursor.
    const dragState = { active: false, roofId: null, index: null, move: null, up: null };
    const dragPlane = new THREE.Plane();
    const dragNormal = new THREE.Vector3();
    const dragNDC    = new THREE.Vector2();
    const dragHit    = new THREE.Vector3();
    const onPanelDragStart = (e) => {
      const { roofId, index } = e.detail || {};
      const s = store.get();
      const roof = s.roofs.find(r => r.id === roofId);
      const panel = roof?.panels?.[index];
      if (!roof || !panel) return;
      // Cancel any prior drag (defensive — pointerleave should have caught it).
      if (dragState.active && dragState.move) {
        gl.domElement.removeEventListener('pointermove', dragState.move);
        gl.domElement.removeEventListener('pointerup',   dragState.up);
        gl.domElement.removeEventListener('pointerleave', dragState.up);
      }
      const n = roof.plane.normal || {};
      dragNormal.set(n.x ?? 0, n.y ?? 1, n.z ?? 0).normalize();
      const p = panel.pos || {};
      dragPlane.setFromNormalAndCoplanarPoint(
        dragNormal,
        new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0),
      );
      dragState.active = true;
      dragState.roofId = roofId;
      dragState.index  = index;
      if (controlsRef.current) controlsRef.current.enabled = false;
      const dom = gl.domElement;
      const move = (ev) => {
        if (!dragState.active) return;
        const rect = dom.getBoundingClientRect();
        dragNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        dragNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(dragNDC, camera);
        const hit = raycaster.ray.intersectPlane(dragPlane, dragHit);
        if (!hit) return;
        const newPos = { x: hit.x, y: hit.y, z: hit.z };
        store.set(st => ({
          roofs: st.roofs.map(r => r.id !== dragState.roofId ? r : ({
            ...r,
            panels: r.panels.map((pp, i) => i !== dragState.index ? pp : ({ ...pp, pos: newPos })),
          })),
        }));
      };
      const up = () => {
        if (!dragState.active) return;
        dragState.active = false;
        if (controlsRef.current) controlsRef.current.enabled = true;
        dom.removeEventListener('pointermove', move);
        dom.removeEventListener('pointerup',   up);
        dom.removeEventListener('pointerleave', up);
        dragState.move = null;
        dragState.up   = null;
      };
      dragState.move = move;
      dragState.up   = up;
      dom.addEventListener('pointermove', move);
      dom.addEventListener('pointerup',   up);
      dom.addEventListener('pointerleave', up);
    };
    window.addEventListener('panel:select',           onPanelSelect);
    window.addEventListener('panel:deleteSelected',   onPanelDeleteSelected);
    window.addEventListener('panel:copySelected',     onPanelCopySelected);
    window.addEventListener('panel:enterDropMode',    onPanelEnterDropMode);
    window.addEventListener('panel:exitDropMode',     onPanelExitDropMode);
    window.addEventListener('panel:rotate',           onPanelRotate);
    window.addEventListener('panel:dragStart',        onPanelDragStart);
    window.addEventListener('template:save', onTemplateSave);
    window.addEventListener('template:load', onTemplateLoad);
    window.addEventListener('draft:save',    onDraftSave);
    window.addEventListener('draft:load',    onDraftLoad);
    window.addEventListener('draft:new',     onDraftNew);
    window.addEventListener('draft:close',   onDraftClose);
    window.addEventListener('draft:delete',  onDraftDelete);
    window.addEventListener('template:delete', onTemplateDelete);
    return () => {
      window.removeEventListener('panels:place', onPlace);
      window.removeEventListener('panels:clear', onClear);
      window.removeEventListener('roofs:clearAll', onClearAll);
      window.removeEventListener('workspace:clear', onWorkspaceClear);
      window.removeEventListener('roofs:deleteSelected', onDeleteSelected);
      window.removeEventListener('roofs:keepSelected', onKeepSelected);
      window.removeEventListener('roofs:merge', onMerge);
      window.removeEventListener('panels:copy',  onPanelsCopy);
      window.removeEventListener('panels:paste', onPanelsPaste);
      window.removeEventListener('panel:select',           onPanelSelect);
      window.removeEventListener('panel:deleteSelected',   onPanelDeleteSelected);
      window.removeEventListener('panel:copySelected',     onPanelCopySelected);
      window.removeEventListener('panel:enterDropMode',    onPanelEnterDropMode);
      window.removeEventListener('panel:exitDropMode',     onPanelExitDropMode);
      window.removeEventListener('panel:rotate',           onPanelRotate);
      window.removeEventListener('panel:dragStart',        onPanelDragStart);
      window.removeEventListener('template:save', onTemplateSave);
      window.removeEventListener('template:load', onTemplateLoad);
      window.removeEventListener('draft:save',    onDraftSave);
      window.removeEventListener('draft:load',    onDraftLoad);
      window.removeEventListener('draft:new',     onDraftNew);
      window.removeEventListener('draft:close',   onDraftClose);
      window.removeEventListener('draft:delete',  onDraftDelete);
      window.removeEventListener('template:delete', onTemplateDelete);
    };
  }, []);

  // ── Mouse camera interaction: drag pans the camera, wheel zooms. Rotation
  // happens only via the on-screen buttons. Disable mouse drag in modes where
  // the overlay needs the pointer (crop / drag-select / erase).
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    c.enabled = (mode === 'orbit');
  }, [mode]);

  // ── Panel drop mode: click on the building to drop a copy of the
  // clipboard panel exactly on whatever roof you clicked. Esc exits.
  useEffect(() => {
    if (mode !== 'panel-drop') return;
    const dom = gl.domElement;
    const onClick = (ev) => {
      // Ignore the click if it bubbled from a UI element on top of the canvas
      if (ev.target !== dom) return;
      const s = store.get();
      const recipe = s.singlePanelClipboard;
      if (!recipe) { store.set({ mode: 'orbit', hint: 'No panel in clipboard' }); return; }
      const rect = dom.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top)  / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      raycaster.far = 10000;
      const hits = raycaster.intersectObjects(meshesRef.current, false);
      if (!hits.length) { store.set({ hint: 'Click missed the building · try again' }); return; }
      const h = hits[0];
      const hn = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
      // Find which roof's polygon mask contains this hit
      let host = null;
      for (const r of s.roofs) {
        const p = r.plane;
        const d = h.point.clone().sub(p.centre);
        if (Math.abs(d.dot(p.normal)) > 2.5) continue;
        const lu = d.dot(p.u), lv = d.dot(p.v);
        if (Array.isArray(p.mask) && p.mask.length >= 3) {
          if (pointInPoly2D(lu, lv, p.mask)) { host = r; break; }
        } else if (Math.abs(lu) <= p.width/2 && Math.abs(lv) <= p.height/2) {
          host = r; break;
        }
      }
      if (!host) { store.set({ hint: 'No roof under the click · drop must land on a detected roof' }); return; }
      // Use the FITTED PLANE's normal (not the noisy mesh face normal) so
      // dropped panels share the same orientation as the mass-fill grid.
      // Build slope-aligned (uHat, vHat) directly from the plane normal so
      // vHat = downhill direction. Manual angle then rotates that basis
      // around the plane normal.
      const np = host.plane.normal;
      const dY = -np.y;
      let uHat0, vHat0;
      const dx = 0      - dY * np.x;
      const dy = -1     - dY * np.y;
      const dz = 0      - dY * np.z;
      const dLen = Math.hypot(dx, dy, dz);
      if (s.panelAutoAlign && dLen > 1e-3) {
        vHat0 = new THREE.Vector3(dx / dLen, dy / dLen, dz / dLen);
        uHat0 = new THREE.Vector3().crossVectors(np, vHat0).normalize();
      } else {
        uHat0 = host.plane.u.clone();
        vHat0 = host.plane.v.clone();
      }
      const a = THREE.MathUtils.degToRad(recipe.angleDeg ?? 0);
      const cosA = Math.cos(a), sinA = Math.sin(a);
      const uHat = uHat0.clone().multiplyScalar(cosA).addScaledVector(vHat0, sinA);
      const vHat = uHat0.clone().multiplyScalar(-sinA).addScaledVector(vHat0, cosA);
      const tilt = THREE.MathUtils.degToRad(s.panelTiltDeg ?? 0);
      const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
      const yAxis = host.plane.normal.clone().multiplyScalar(cosT).addScaledVector(vHat, sinT);
      const zAxis = vHat.clone().multiplyScalar(cosT).addScaledVector(host.plane.normal, -sinT);
      const m = new THREE.Matrix4().makeBasis(uHat, yAxis, zAxis);
      const quat = new THREE.Quaternion().setFromRotationMatrix(m);
      // Honour landscape on the dropped panel too
      const baseW = recipe.w, baseH = recipe.h;
      const pw = s.panelLandscape ? baseH : baseW;
      const ph = s.panelLandscape ? baseW : baseH;
      const tiltLift = (ph / 2) * Math.abs(sinT);
      // Anchor to whichever is HIGHER along the plane normal: the actual
      // hit point or the projection onto the fitted plane. Guarantees the
      // panel sits above the visualised yellow plane AND the real mesh.
      const offset    = h.point.clone().sub(host.plane.centre);
      const planePoint = host.plane.centre.clone()
        .addScaledVector(host.plane.u, offset.dot(host.plane.u))
        .addScaledVector(host.plane.v, offset.dot(host.plane.v));
      const hitProj   = h.point.clone().sub(host.plane.centre).dot(host.plane.normal);
      const planeProj = planePoint.clone().sub(host.plane.centre).dot(host.plane.normal);
      const anchor    = hitProj > planeProj ? h.point.clone() : planePoint;
      const lift = (s.panelSurfaceOffset ?? 0.12) + 0.02 + tiltLift;
      const pos  = anchor.addScaledVector(host.plane.normal, lift);
      const newPanel = { pos, quat, w: pw, h: ph };
      store.set(st => ({
        roofs: st.roofs.map(r => r.id === host.id
          ? { ...r, panels: [...(r.panels ?? []), newPanel] }
          : r),
        hint: `Dropped 1 panel on ${host.id} · keep clicking, Esc to stop`,
      }));
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') store.set({ mode: 'orbit', hint: 'Drop mode off' });
    };
    dom.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    const prevCursor = dom.style.cursor;
    dom.style.cursor = 'crosshair';
    return () => {
      dom.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      dom.style.cursor = prevCursor;
    };
  }, [mode]);

  // ── Toggle 3D model visibility (hide buildings to inspect masks/cuts only)
  useEffect(() => {
    if (modelRef.current) modelRef.current.visible = modelVisible;
  }, [modelVisible, roofs.length]);

  // ── Toggle building textures (swap to flat shaded gray for plane inspection)
  useEffect(() => {
    const meshes = meshesRef.current;
    if (!meshes.length) return;
    if (texturesOn) {
      for (const m of meshes) {
        const orig = originalMaterialsRef.current.get(m);
        if (orig) m.material = orig;
      }
    } else {
      const inspectMat = new THREE.MeshLambertMaterial({ color: 0xb8b8b8, flatShading: !smoothSurfaceOn });
      for (const m of meshes) {
        if (!originalMaterialsRef.current.has(m)) originalMaterialsRef.current.set(m, m.material);
        if (m.geometry && smoothSurfaceOn) m.geometry.computeVertexNormals();
        m.material = inspectMat;
      }
    }
  }, [texturesOn, smoothSurfaceOn, roofs.length]);

  // ── Mesh-smoothing slider (0..1): Taubin λ/μ smooth model geometry, then
  // rebuild the upward-triangle index so subsequent roof detection works on
  // the smoother surface. 0 instantly restores the original mesh. The work
  // is debounced so dragging the slider stays interactive.
  useEffect(() => {
    const meshes = meshesRef.current;
    if (!meshes.length || !modelRef.current) return;
    const handle = setTimeout(() => {
      if (meshSmoothLevel <= 0.001) {
        resetMeshSmoothing(meshes);
      } else {
        smoothMeshes(meshes, meshSmoothLevel);
      }
      upTrisRef.current = buildUpwardTriangles(modelRef.current);
      store.set(s => ({
        hud: { ...s.hud, upTriangles: upTrisRef.current.length },
        hint: meshSmoothLevel > 0
          ? `Surface smoothness ${Math.round(meshSmoothLevel * 100)}% · ${upTrisRef.current.length.toLocaleString()} roof faces re-indexed`
          : `Mesh restored to original · ${upTrisRef.current.length.toLocaleString()} roof faces`,
      }));
    }, 80); // debounce
    return () => clearTimeout(handle);
  }, [meshSmoothLevel]);

  // ── Live HUD updates each frame
  useFrame(() => {
    // Drive any in-flight camera tween BEFORE reading position into the HUD.
    const anim = camAnimRef.current;
    if (anim) {
      const now = performance.now();
      let t = (now - anim.startTime) / anim.duration;
      if (t >= 1) { t = 1; }
      // Smoothstep ease (cubic) for a natural in/out feel
      const k = t * t * (3 - 2 * t);
      camera.position.lerpVectors(anim.startPos, anim.endPos, k);
      controlsRef.current?.target.lerpVectors(anim.startTarget, anim.endTarget, k);
      camera.up.set(0, 1, 0);
      camera.lookAt(controlsRef.current?.target ?? anim.endTarget);
      controlsRef.current?.update();
      if (t >= 1) camAnimRef.current = null;
    }
    const s = store.get();
    if (!s.debugOn) return;
    const box = modelBoxRef.current;
    const sz = box ? box.getSize(new THREE.Vector3()) : null;
    const tgt = controlsRef.current?.target ?? new THREE.Vector3();
    store.set(st => ({
      hud: {
        ...st.hud,
        cameraPos:    `${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}`,
        cameraTarget: `${tgt.x.toFixed(1)}, ${tgt.y.toFixed(1)}, ${tgt.z.toFixed(1)}`,
        modelBounds:  box ? `x[${box.min.x.toFixed(0)}..${box.max.x.toFixed(0)}] y[${box.min.y.toFixed(0)}..${box.max.y.toFixed(0)}] z[${box.min.z.toFixed(0)}..${box.max.z.toFixed(0)}]` : '–',
        modelSize:    sz ? `${sz.x.toFixed(1)} × ${sz.y.toFixed(1)} × ${sz.z.toFixed(1)}` : '–',
        upTriangles:  upTrisRef.current.length,
        roofCount:    st.roofs.length,
        activeRoof:   st.activeRoofId ?? 'none',
      },
    }));
  });

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={1}
        maxDistance={5000}
        minPolarAngle={0}
        maxPolarAngle={Math.PI}
        enableRotate={false}
        enablePan={true}
        panSpeed={1.0}
        enableZoom={true}
        zoomSpeed={1.0}
        screenSpacePanning={true}
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      />
      <gridHelper args={[600, 30, 0x335577, 0x223344]} position={[0, 0.01, 0]} />
      <axesHelper args={[40]} position={[0, 0.02, 0]} />
      <RoofVisuals roofs={roofs} />
      <PolygonDraftViz />
      <SunVisual />
      <SunAnimator />
      <CompassRose />
      <RoofIrradiancePlanes />
    </>
  );
}

// In-progress polygon: cyan corner markers + connecting line. Visible
// whenever there is at least one drafted point, regardless of mode (so it
// stays put if the user briefly switches to View to rotate the camera).
function PolygonDraftViz() {
  const draft = useStore(s => s.polygonDraft);
  const pts = useMemo(
    () => (draft ?? []).map(p => new THREE.Vector3(p.x, p.y, p.z)),
    [draft]
  );
  const lineGeom = useMemo(() => {
    if (pts.length < 2) return null;
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [pts]);
  const closeGeom = useMemo(() => {
    if (pts.length < 3) return null;
    return new THREE.BufferGeometry().setFromPoints([pts[pts.length - 1], pts[0]]);
  }, [pts]);
  if (!pts.length) return null;
  return (
    <group>
      {pts.map((p, i) => (
        <mesh key={i} position={p.toArray()}>
          <sphereGeometry args={[0.35, 12, 8]} />
          <meshBasicMaterial color={i === 0 ? 0xffd166 : 0x06b6d4} depthTest={false} />
        </mesh>
      ))}
      {lineGeom && (
        <line geometry={lineGeom}>
          <lineBasicMaterial color={0x06b6d4} linewidth={2} depthTest={false} />
        </line>
      )}
      {closeGeom && (
        <line geometry={closeGeom}>
          <lineDashedMaterial color={0x06b6d4} dashSize={0.6} gapSize={0.4} depthTest={false} />
        </line>
      )}
    </group>
  );
}

function RoofVisuals({ roofs }) {
  const activeId = useStore(s => s.activeRoofId);
  const selectedIds = useStore(s => s.selectedRoofIds);
  const list = roofs ?? [];
  return (
    <>
      {list.map(r => (
        <group key={r.id}>
          <RoofPlaneViz
            roof={r}
            active={r.id === activeId}
            selected={selectedIds.includes(r.id)}
          />
          {(r.panels ?? []).map((p, i) => (
            <Panel key={`${r.id}-${i}`} panel={p} roofId={r.id} index={i} />
          ))}
        </group>
      ))}
    </>
  );
}

function RoofPlaneViz({ roof, active, selected }) {
  const p = roof.plane;
  const quat = useMemo(() => {
    const m = new THREE.Matrix4().makeBasis(p.u, p.v, p.normal);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }, [p]);
  const offsetCentre = useMemo(() => p.centre.clone().addScaledVector(p.normal, 0.05), [p]);

  // ── Mask geometry from the cluster's true silhouette polygon
  const hasMask = Array.isArray(p.mask) && p.mask.length >= 3;

  const maskGeom = useMemo(() => {
    if (!hasMask) return null;
    const shape = new THREE.Shape(p.mask.map(([u, v]) => new THREE.Vector2(u, v)));
    return new THREE.ShapeGeometry(shape);
  }, [p, hasMask]);

  const maskOutline = useMemo(() => {
    if (!hasMask) return null;
    const pts = p.mask.map(([u, v]) => new THREE.Vector3(u, v, 0.01));
    pts.push(pts[0].clone());
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [p, hasMask]);

  // Debug arrow showing the algorithm's computed in-plane downhill direction
  // (u,v coords). Drawn inside the group, which is already in the (u,v,normal)
  // basis, so we can just lay it flat on the local XY plane.
  const slopeArrow = useMemo(() => {
    const gradU = -p.u.y;
    const gradV = -p.v.y;
    const L = Math.hypot(gradU, gradV);
    if (L < 1e-4) return null;
    const dx = gradU / L;
    const dy = gradV / L;
    const len = Math.min(p.width, p.height) * 0.4;
    const tip = new THREE.Vector3(dx * len, dy * len, 0.05);
    const tail = new THREE.Vector3(-dx * len * 0.1, -dy * len * 0.1, 0.05);
    // Simple arrow: shaft + two head segments
    const headLen = len * 0.18;
    const perpX = -dy, perpY = dx;
    const head1 = new THREE.Vector3(
      tip.x - dx * headLen + perpX * headLen * 0.5,
      tip.y - dy * headLen + perpY * headLen * 0.5,
      0.05,
    );
    const head2 = new THREE.Vector3(
      tip.x - dx * headLen - perpX * headLen * 0.5,
      tip.y - dy * headLen - perpY * headLen * 0.5,
      0.05,
    );
    return new THREE.BufferGeometry().setFromPoints([
      tail, tip, head1, tip, head2,
    ]);
  }, [p]);

  // Fallback rectangle outline when no mask
  const rectGeom = useMemo(() => {
    if (hasMask) return null;
    const w = p.width, h = p.height;
    const pts = [
      new THREE.Vector3(-w/2, -h/2, 0.01),
      new THREE.Vector3( w/2, -h/2, 0.01),
      new THREE.Vector3( w/2,  h/2, 0.01),
      new THREE.Vector3(-w/2,  h/2, 0.01),
      new THREE.Vector3(-w/2, -h/2, 0.01),
    ];
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [p, hasMask]);

  // Shift-click toggles multi-selection. Plain click sets active and clears
  // the multi-select set. Used by the floating action bar in PlannerView.
  const onPick = (e) => {
    e.stopPropagation();
    const shift = !!(e.nativeEvent && (e.nativeEvent.shiftKey || e.nativeEvent.metaKey || e.nativeEvent.ctrlKey));
    if (shift) {
      store.set(s => {
        const has = s.selectedRoofIds.includes(roof.id);
        const next = has
          ? s.selectedRoofIds.filter(id => id !== roof.id)
          : [...s.selectedRoofIds, roof.id];
        return { selectedRoofIds: next, hint: `${next.length} roof${next.length===1?'':'s'} selected · use the floating bar to merge or delete` };
      });
    } else {
      store.set({ activeRoofId: roof.id, selectedRoofIds: [], hint: `Highlighted ${roof.id}` });
    }
  };

  // Visual style: active = orange, selected = purple, idle = pale green
  const fillColor    = active ? 0xf5a623 : (selected ? 0xa855f7 : 0x4ade80);
  const fillOpacity  = active ? 0.55 : (selected ? 0.6  : 0.40);
  const lineColor    = active ? 0xffd700 : (selected ? 0xd8b4fe : 0x16a34a);

  return (
    <group position={offsetCentre.toArray()} quaternion={quat.toArray()}>
      {hasMask ? (
        <>
          <mesh geometry={maskGeom} onClick={onPick}>
            <meshBasicMaterial
              color={fillColor}
              transparent
              opacity={fillOpacity}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <line geometry={maskOutline}>
            <lineBasicMaterial color={lineColor} linewidth={2} />
          </line>
        </>
      ) : (
        <>
          <mesh onClick={onPick}>
            <planeGeometry args={[p.width, p.height]} />
            <meshBasicMaterial color={active ? 0xf5a623 : (selected ? 0x4ade80 : 0xffd47a)} transparent opacity={active ? 0.45 : (selected ? 0.45 : 0.25)} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <line geometry={rectGeom}>
            <lineBasicMaterial color={lineColor} />
          </line>
        </>
      )}
      {slopeArrow && (
        <line geometry={slopeArrow}>
          <lineBasicMaterial color={0xff00ff} linewidth={3} />
        </line>
      )}
    </group>
  );
}

function Panel({ panel, roofId, index }) {
  const matRef  = useRef();
  const visible = useStore(s => s.panelsVisible);
  const opacity = useStore(s => s.panelOpacity);
  const key = `${roofId}#${index}`;

  // Imperatively update material colour each frame without re-rendering React
  useFrame(() => {
    if (!matRef.current) return;
    const s = store.get();
    if (s.activeTab === 'solar') {
      const dir = sunDirection(s.solarLatitude, s.solarDayOfYear, s.solarTime);
      const irr = dir.belowHorizon ? 0 : panelIrradiance(panel.quat, dir);
      matRef.current.color.setHex(irradianceToHex(irr));
    } else {
      const selected = s.selectedPanelKeys.includes(key);
      matRef.current.color.setHex(selected ? 0x4ade80 : 0x1a237e);
    }
  });

  const onPointerDown = (e) => {
    e.stopPropagation();
    const s = store.get();
    if (s.activeTab === 'solar') {
      store.set({ activePanelDashboard: { roofId, index } });
      return;
    }
    const shift = !!(e.nativeEvent && (e.nativeEvent.shiftKey || e.nativeEvent.metaKey || e.nativeEvent.ctrlKey));
    // Select first so the side panel switches to the per-panel controls,
    // then start the drag — releasing without moving still leaves the
    // panel selected (a plain click).
    window.dispatchEvent(new CustomEvent('panel:select',    { detail: { roofId, index, shift } }));
    if (!shift) {
      window.dispatchEvent(new CustomEvent('panel:dragStart', { detail: { roofId, index } }));
    }
  };

  if (!visible) return null;
  const transparent = opacity < 1;
  // Defensive: panel.pos / panel.quat may have been round-tripped through
  // IndexedDB (structured-clone strips THREE.* prototypes), in which case
  // they're plain {x,y,z[,w]} objects without `.toArray()`. Coerce here
  // so no upstream code path can crash this render.
  const p = panel.pos  || {};
  const q = panel.quat || {};
  const posArr  = [p.x ?? 0, p.y ?? 0, p.z ?? 0];
  const quatArr = [q.x ?? 0, q.y ?? 0, q.z ?? 0, q.w ?? 1];
  return (
    <mesh
      position={posArr}
      quaternion={quatArr}
      onPointerDown={onPointerDown}
    >
      <boxGeometry args={[panel.w, 0.04, panel.h]} />
      <meshBasicMaterial
        ref={matRef}
        color={0x1a237e}
        transparent={transparent}
        opacity={opacity}
        depthWrite={!transparent}
      />
    </mesh>
  );
}

// ── Compass rose ─────────────────────────────────────────────────────────

const COMPASS_DIRS = [
  { label: 'N', x:   0, z: -130, color: '#ef4444', desc: 'Nord'  },
  { label: 'S', x:   0, z:  130, color: '#94a3b8', desc: 'Sud'   },
  { label: 'E', x:  130, z:   0, color: '#94a3b8', desc: 'Est'   },
  { label: 'W', x: -130, z:   0, color: '#94a3b8', desc: 'Ovest' },
];

function CompassRose() {
  const loaded = useStore(s => s.loaded);

  // useMemo must be called unconditionally (Rules of Hooks) — before any early return
  const lineGeom = useMemo(() => {
    const pts = [
      new THREE.Vector3(-130, 0.3, 0), new THREE.Vector3(130, 0.3, 0),
      new THREE.Vector3(0, 0.3, -130), new THREE.Vector3(0, 0.3, 130),
    ];
    const geom = new THREE.BufferGeometry();
    geom.setFromPoints(pts);
    return geom;
  }, []);

  if (!loaded) return null;

  return (
    <group>
      {/* Cross axes */}
      <lineSegments geometry={lineGeom}>
        <lineBasicMaterial color={0x334466} />
      </lineSegments>
    </group>
  );
}

// ── Solar components ─────────────────────────────────────────────────────

// Returns [x, y, z] position on the E→W semicircular orbit arc, or null when
// the sun is below the horizon. θ goes 0 (East, +X) → π (West, -X) so the
// arc is tangent-vertical at both endpoints (perpendicular to the horizon).
function computeSunOrbitPos(latDeg, doy, hour, center, radius) {
  const D    = Math.PI / 180;
  const decl = -23.45 * Math.cos((360 / 365) * (doy + 10) * D) * D;
  const lat  = latDeg * D;
  const cosHA = -Math.tan(lat) * Math.tan(decl);
  if (cosHA > 1) return null; // polar night
  const haSS  = cosHA < -1 ? Math.PI : Math.acos(cosHA);
  const tRise = 12 - (haSS / D) / 15;
  const tSet  = 12 + (haSS / D) / 15;
  if (hour <= tRise || hour >= tSet) return null;
  const t     = (hour - tRise) / (tSet - tRise); // 0..1
  const theta = t * Math.PI; // 0 = East, π = West
  return [
    center[0] + radius * Math.cos(theta), // +radius at East, -radius at West
    center[1] + radius * Math.sin(theta), // 0 at E/W, radius at solar noon
    center[2],                             // stays in the E-W vertical plane
  ];
}

// Sun sphere + directional light. Orbit is a perfect E→W semicircle whose
// pivot and radius track the current visible region (crop or full model).
function SunVisual() {
  const sunRef   = useRef();
  const lightRef = useRef();

  useFrame(() => {
    const s = store.get();
    if (!s.loaded || s.activeTab !== 'solar') {
      if (sunRef.current)   sunRef.current.visible   = false;
      if (lightRef.current) lightRef.current.visible = false;
      return;
    }
    const pos = computeSunOrbitPos(s.solarLatitude, s.solarDayOfYear, s.solarTime, s.sunOrbitCenter, s.sunOrbitRadius);
    const visible = pos !== null;
    if (sunRef.current) {
      sunRef.current.visible = visible;
      if (visible) sunRef.current.position.set(pos[0], pos[1], pos[2]);
    }
    if (lightRef.current) {
      lightRef.current.visible = visible;
      if (visible) lightRef.current.position.set(pos[0], pos[1], pos[2]);
    }
  });

  return (
    <>
      <mesh ref={sunRef}>
        <sphereGeometry args={[14, 20, 16]} />
        <meshBasicMaterial color={0xffcc00} />
      </mesh>
      <directionalLight ref={lightRef} color={0xfff5cc} intensity={1.8} castShadow={false} />
    </>
  );
}

// Transparent plane per roof showing the sun-ray incidence geometry.
// Each plane passes through the sun sphere centre and the roof centroid,
// lying in the vertical plane that contains the sun→roof vector.
function RoofIrradiancePlane({ roof }) {
  const meshRef = useRef();
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
    return g;
  }, []);

  useFrame(() => {
    if (!meshRef.current) return;
    const s = store.get();
    if (!s.loaded || s.activeTab !== 'solar' || !roof?.plane?.centre) { meshRef.current.visible = false; return; }

    const pos = computeSunOrbitPos(s.solarLatitude, s.solarDayOfYear, s.solarTime, s.sunOrbitCenter, s.sunOrbitRadius);
    if (!pos) { meshRef.current.visible = false; return; }

    const sv = new THREE.Vector3(pos[0], pos[1], pos[2]);
    const rc = roof.plane.centre; // THREE.Vector3
    const toRoof = rc.clone().sub(sv);
    if (toRoof.lengthSq() < 1) { meshRef.current.visible = false; return; }

    // Horizontal half-width vector — perpendicular to sun→roof in the XZ plane
    let xDir = new THREE.Vector3().crossVectors(toRoof, new THREE.Vector3(0, 1, 0));
    if (xDir.lengthSq() < 0.001) xDir.set(1, 0, 0);
    else xDir.normalize();
    xDir.multiplyScalar(Math.max(10, s.sunOrbitRadius * 0.07));

    const SL = sv.clone().sub(xDir);
    const SR = sv.clone().add(xDir);
    const RL = rc.clone().sub(xDir);
    const RR = rc.clone().add(xDir);

    const arr = geo.attributes.position.array;
    // Triangle 1: SL, SR, RL
    arr[0]  = SL.x; arr[1]  = SL.y; arr[2]  = SL.z;
    arr[3]  = SR.x; arr[4]  = SR.y; arr[5]  = SR.z;
    arr[6]  = RL.x; arr[7]  = RL.y; arr[8]  = RL.z;
    // Triangle 2: SR, RR, RL
    arr[9]  = SR.x; arr[10] = SR.y; arr[11] = SR.z;
    arr[12] = RR.x; arr[13] = RR.y; arr[14] = RR.z;
    arr[15] = RL.x; arr[16] = RL.y; arr[17] = RL.z;
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();
    meshRef.current.visible = true;
  });

  return (
    <mesh ref={meshRef} geometry={geo} visible={false}>
      <meshBasicMaterial color={0xffdd44} transparent opacity={0.13} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function RoofIrradiancePlanes() {
  const roofs  = useStore(s => s.roofs);
  const loaded = useStore(s => s.loaded);
  const tab    = useStore(s => s.activeTab);
  if (!loaded || tab !== 'solar') return null;
  return <>{roofs.map(r => <RoofIrradiancePlane key={r.id} roof={r} />)}</>;
}

// Increments solarTime each frame when playing; reads speed from a module-level ref
// updated by the 'solar:speed' custom event emitted by SolarTool.
let _solarSpeed = 1;
if (typeof window !== 'undefined') {
  window.addEventListener('solar:speed', (e) => { _solarSpeed = e.detail; });
}

function SunAnimator() {
  useFrame((_, delta) => {
    const s = store.get();
    if (!s.solarPlaying) return;
    // 1× speed = 1 day in ~30 s → 24/30 ≈ 0.8 h/s
    const next = (s.solarTime + delta * 0.8 * _solarSpeed) % 24;
    store.set({ solarTime: next });
  });
  return null;
}

// ── Helpers
function regionBox(modelBox, cropBounds) {
  if (!modelBox) return null;
  if (!cropBounds) return modelBox;
  return new THREE.Box3(
    new THREE.Vector3(cropBounds.minX, modelBox.min.y, cropBounds.minZ),
    new THREE.Vector3(cropBounds.maxX, modelBox.max.y, cropBounds.maxZ)
  );
}

function fitCameraToBox(camera, controls, box, kind) {
  if (!box || !controls) return;
  const sz = box.getSize(new THREE.Vector3());
  const ct = box.getCenter(new THREE.Vector3());
  const fovV = camera.fov * Math.PI / 180;
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
  if (kind === 'top') {
    const distZ = (sz.z * 0.5 * 1.15) / Math.tan(fovV / 2);
    const distX = (sz.x * 0.5 * 1.15) / Math.tan(fovH / 2);
    const dist  = Math.max(distX, distZ, sz.y * 2);
    controls.target.set(ct.x, 0, ct.z);
    camera.up.set(0, 0, -1);
    camera.position.set(ct.x, dist, ct.z);
  } else {
    // 45° down from top, looking from front-right corner.
    // Fit by projecting the AABB onto the camera's view plane and sizing
    // distance to the larger of the projected width/height — tighter than
    // a bounding-sphere fit, which was overshooting on elongated models.
    const phi = Math.PI / 4;          // polar angle from +Y
    const theta = Math.PI / 4;        // azimuth around Y
    const sinP = Math.sin(phi);
    const dir = new THREE.Vector3(
      sinP * Math.sin(theta),
      Math.cos(phi),
      sinP * Math.cos(theta),
    ).normalize();
    // Build a camera-aligned basis: forward = -dir, up ≈ world Y, right = up × forward.
    const fwd   = dir.clone().multiplyScalar(-1);
    const right = new THREE.Vector3(0, 1, 0).cross(fwd).normalize();
    const up    = fwd.clone().cross(right).normalize();
    // Project every AABB corner onto (right, up) to get the screen-space half-extents.
    let halfW = 0, halfH = 0;
    const c = ct;
    for (let xi = -1; xi <= 1; xi += 2)
    for (let yi = -1; yi <= 1; yi += 2)
    for (let zi = -1; zi <= 1; zi += 2) {
      const corner = new THREE.Vector3(
        c.x + xi * sz.x * 0.5,
        c.y + yi * sz.y * 0.5,
        c.z + zi * sz.z * 0.5,
      ).sub(c);
      halfW = Math.max(halfW, Math.abs(corner.dot(right)));
      halfH = Math.max(halfH, Math.abs(corner.dot(up)));
    }
    const distH = halfH / Math.tan(fovV / 2);
    const distW = halfW / Math.tan(fovH / 2);
    const dist  = Math.max(distH, distW) * 1.05; // 5% breathing room
    controls.target.copy(ct);
    camera.up.set(0, 1, 0);
    camera.position.set(
      ct.x + dist * dir.x,
      ct.y + dist * dir.y,
      ct.z + dist * dir.z,
    );
  }
  camera.lookAt(controls.target);
  camera.updateProjectionMatrix();
  controls.update();
}

function fullReset(camera, controls, box, gl, scene) {
  store.set({ roofs: [], activeRoofId: null, cropBounds: null, mode: 'orbit' });
  gl.clippingPlanes = [];
  removeCropHelper(scene);
  fitCameraToBox(camera, controls, box, 'persp');
  store.set({ hint: 'Full reset · model fit to view' });
}

function zoom(camera, controls, dir) {
  if (!controls) return;
  const v = camera.position.clone().sub(controls.target);
  v.multiplyScalar(dir === 'in' ? 0.85 : 1.18);
  camera.position.copy(controls.target).add(v);
  controls.update();
}

function rotateOrbit(camera, controls, dir) {
  if (!controls) return;
  const step = THREE.MathUtils.degToRad(15);
  const offset = camera.position.clone().sub(controls.target);
  const sph = new THREE.Spherical().setFromVector3(offset);
  if (dir === 'left')  sph.theta -= step;
  if (dir === 'right') sph.theta += step;
  if (dir === 'up')    sph.phi   = Math.max(0.05, sph.phi - step);
  if (dir === 'down')  sph.phi   = Math.min(Math.PI - 0.05, sph.phi + step);
  offset.setFromSpherical(sph);
  camera.position.copy(controls.target).add(offset);
  camera.lookAt(controls.target);
  controls.update();
}

// Snap the polar angle (tilt down from world up) to `phi` while preserving
// the current target, azimuth, and distance. Used by the "Top" button so it
// just rotates 45° from above without re-framing the whole scene.
function snapPolar(camera, controls, phi) {
  if (!controls) return;
  camera.up.set(0, 1, 0);
  const offset = camera.position.clone().sub(controls.target);
  const sph = new THREE.Spherical().setFromVector3(offset);
  sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, phi));
  offset.setFromSpherical(sph);
  camera.position.copy(controls.target).add(offset);
  camera.lookAt(controls.target);
  controls.update();
}

// Smoothly tween the camera's polar angle to `phi` over ~600 ms. Target,
// azimuth, and distance stay fixed, so the camera "rises" to the requested
// tilt without re-framing. Stores the tween in `animRef`; the per-frame
// driver in useFrame applies it and clears the ref when done.
function animatePolar(camera, controls, animRef, phi, durationMs = 600) {
  if (!controls) return;
  camera.up.set(0, 1, 0);
  const startPos    = camera.position.clone();
  const startTarget = controls.target.clone();
  const offset = startPos.clone().sub(startTarget);
  const sph = new THREE.Spherical().setFromVector3(offset);
  sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, phi));
  const endOffset = new THREE.Vector3().setFromSpherical(sph);
  const endPos = startTarget.clone().add(endOffset);
  animRef.current = {
    startPos, endPos,
    startTarget, endTarget: startTarget.clone(),
    startTime: performance.now(),
    duration: durationMs,
  };
}

// Smoothly tween the camera's azimuth (theta) to a specific compass
// bearing. We pick the *shorter* angular path so a click on the opposite
// compass point swings around the closest way instead of unwinding 360°.
// Polar angle, distance and target stay fixed, so the building stays
// centred while the view orbits horizontally.
function animateAzimuth(camera, controls, animRef, targetTheta, durationMs = 600) {
  if (!controls) return;
  camera.up.set(0, 1, 0);
  const startPos    = camera.position.clone();
  const startTarget = controls.target.clone();
  const offset = startPos.clone().sub(startTarget);
  const sph = new THREE.Spherical().setFromVector3(offset);
  // Pick the equivalent target theta within ±π of the current theta so the
  // tween takes the short way around.
  let dst = targetTheta;
  while (dst - sph.theta >  Math.PI) dst -= Math.PI * 2;
  while (dst - sph.theta < -Math.PI) dst += Math.PI * 2;
  sph.theta = dst;
  const endOffset = new THREE.Vector3().setFromSpherical(sph);
  const endPos = startTarget.clone().add(endOffset);
  animRef.current = {
    startPos, endPos,
    startTarget, endTarget: startTarget.clone(),
    startTime: performance.now(),
    duration: durationMs,
  };
}

function panCamera(camera, controls, dir) {
  if (!controls) return;
  // Pan distance scales with current zoom so it feels consistent.
  const dist = camera.position.distanceTo(controls.target);
  const step = Math.max(2, dist * 0.12);
  // Camera-right (screen X) and world-up (screen Y) keep panning intuitive
  // even when the camera is tilted close to top-down.
  const right = new THREE.Vector3();
  camera.getWorldDirection(right);
  right.cross(camera.up).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const delta = new THREE.Vector3();
  if (dir === 'left')  delta.copy(right).multiplyScalar(-step);
  if (dir === 'right') delta.copy(right).multiplyScalar( step);
  if (dir === 'up')    delta.copy(up).multiplyScalar( step);
  if (dir === 'down')  delta.copy(up).multiplyScalar(-step);
  camera.position.add(delta);
  controls.target.add(delta);
  controls.update();
}

// Deep-clone a roof for storage in a template. Plane vectors are three.js
// objects so we clone() them; mask is a plain [u,v][] array so we copy by
// shape. Panels are intentionally dropped — templates are the BASE only.
function cloneRoofForTemplate(roof) {
  const p = roof.plane || {};
  const v = (o) => {
    const x = o || {};
    return new THREE.Vector3(x.x ?? 0, x.y ?? 0, x.z ?? 0);
  };
  const cloned = {
    id: roof.id,
    panels: [],
    erased: (roof.erased ?? []).map(e => ({ ...e })),
    panelSpec: roof.panelSpec ?? null,
    plane: {
      ...p,
      centre: v(p.centre),
      normal: v(p.normal),
      u:      v(p.u),
      v:      v(p.v),
      mask:   Array.isArray(p.mask) ? p.mask.map(([a, b]) => [a, b]) : p.mask,
    },
  };
  return cloned;
}

// Deep-clone a single panel placement. Always rebuilds real
// THREE.Vector3 / THREE.Quaternion instances so it works for both
// freshly-generated panels and ones that have been round-tripped through
// IndexedDB (structured-clone strips the prototypes, leaving plain
// `{x,y,z[,w]}` objects that crash on `.toArray()`).
function clonePanel(panel) {
  const p = panel.pos  || {};
  const q = panel.quat || {};
  return {
    pos:  new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0),
    quat: new THREE.Quaternion(q.x ?? 0, q.y ?? 0, q.z ?? 0, q.w ?? 1),
    w: panel.w, h: panel.h,
  };
}

function compatiblePlane(plane, seedPoint, seedNormal) {
  // Same orientation? (within 18°)
  if (plane.normal.dot(seedNormal) < Math.cos(THREE.MathUtils.degToRad(18))) return false;
  // Same height band? (within 6 m)
  if (Math.abs(seedPoint.y - plane.centre.y) > 6) return false;
  // Within 2× plane footprint of centre? (XZ distance check)
  const dx = seedPoint.x - plane.centre.x;
  const dz = seedPoint.z - plane.centre.z;
  const horiz = Math.sqrt(dx * dx + dz * dz);
  const reach = 0.6 * Math.max(plane.width, plane.height) + 4;
  return horiz <= reach;
}

function mergedSearchBounds(plane, seedPoint, pad = 6) {
  // Existing plane footprint in XZ
  const r = 0.5 * Math.max(plane.width, plane.height) + pad;
  const minX = Math.min(plane.centre.x - r, seedPoint.x - pad);
  const maxX = Math.max(plane.centre.x + r, seedPoint.x + pad);
  const minZ = Math.min(plane.centre.z - r, seedPoint.z - pad);
  const maxZ = Math.max(plane.centre.z + r, seedPoint.z + pad);
  return { minX, maxX, minZ, maxZ };
}

function screenRectToPlaneLocal({ camera, raycaster, gl, plane, x1, y1, x2, y2 }) {
  const rect = gl.domElement.getBoundingClientRect();
  const corners = [
    [Math.min(x1, x2), Math.min(y1, y2)],
    [Math.max(x1, x2), Math.min(y1, y2)],
    [Math.max(x1, x2), Math.max(y1, y2)],
    [Math.min(x1, x2), Math.max(y1, y2)],
  ];
  const mathPlane = new THREE.Plane(plane.normal.clone(), -plane.normal.dot(plane.centre));
  const tmp = new THREE.Vector3();
  let mnU = Infinity, mxU = -Infinity, mnV = Infinity, mxV = -Infinity;
  let hits = 0;
  for (const [sx, sy] of corners) {
    const ndc = new THREE.Vector2(
      ((sx - rect.left) / rect.width) * 2 - 1,
      -((sy - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(mathPlane, tmp)) continue;
    const d = tmp.clone().sub(plane.centre);
    const u = d.dot(plane.u);
    const v = d.dot(plane.v);
    if (u < mnU) mnU = u;
    if (u > mxU) mxU = u;
    if (v < mnV) mnV = v;
    if (v > mxV) mxV = v;
    hits++;
  }
  if (hits < 3) return null;
  return { u1: mnU, v1: mnV, u2: mxU, v2: mxV };
}

function screenPointsToPlaneLocal({ camera, raycaster, gl, plane, screenPts }) {
  const rect = gl.domElement.getBoundingClientRect();
  const mathPlane = new THREE.Plane(plane.normal.clone(), -plane.normal.dot(plane.centre));
  const tmp = new THREE.Vector3();
  const out = [];
  for (const [sx, sy] of screenPts) {
    const ndc = new THREE.Vector2(
      ((sx - rect.left) / rect.width)  * 2 - 1,
      -((sy - rect.top)  / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(mathPlane, tmp)) continue;
    const d = tmp.clone().sub(plane.centre);
    out.push([d.dot(plane.u), d.dot(plane.v)]);
  }
  return out;
}

function pointInPoly2D(px, py, poly) {
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

// Standard 2D segment vs segment intersection. Returns true if AB ∩ CD.
function segmentsIntersect2D(a, b, c, d) {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1];
  const cx = c[0], cy = c[1], dx = d[0], dy = d[1];
  const r1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const r2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const r3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const r4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  if (((r1 > 0) !== (r2 > 0)) && ((r3 > 0) !== (r4 > 0))) return true;
  return false;
}

function screenRectToWorldBounds({ camera, raycaster, gl, modelBox, x1, y1, x2, y2 }) {
  if (!modelBox) return null;
  const rect = gl.domElement.getBoundingClientRect();
  const corners = [
    [Math.min(x1, x2), Math.min(y1, y2)],
    [Math.max(x1, x2), Math.min(y1, y2)],
    [Math.max(x1, x2), Math.max(y1, y2)],
    [Math.min(x1, x2), Math.max(y1, y2)],
  ];
  const midY = (modelBox.min.y + modelBox.max.y) / 2;
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -midY);
  const tmp = new THREE.Vector3();
  const pts = [];
  for (const [sx, sy] of corners) {
    const ndc = new THREE.Vector2(
      ((sx - rect.left) / rect.width) * 2 - 1,
      -((sy - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(groundPlane, tmp)) pts.push(tmp.clone());
  }
  if (pts.length < 4) return null;
  let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
  pts.forEach(p => {
    if (p.x < mnX) mnX = p.x;
    if (p.x > mxX) mxX = p.x;
    if (p.z < mnZ) mnZ = p.z;
    if (p.z > mxZ) mxZ = p.z;
  });
  return { minX: mnX, maxX: mxX, minZ: mnZ, maxZ: mxZ };
}

function drawCropHelper(scene, modelBox, b) {
  removeCropHelper(scene);
  const y = (modelBox?.min.y ?? 0) + 0.05;
  const pts = [
    new THREE.Vector3(b.minX, y, b.minZ),
    new THREE.Vector3(b.maxX, y, b.minZ),
    new THREE.Vector3(b.maxX, y, b.maxZ),
    new THREE.Vector3(b.minX, y, b.maxZ),
    new THREE.Vector3(b.minX, y, b.minZ),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf5a623 }));
  line.name = '__cropHelper__';
  scene.add(line);
}

function removeCropHelper(scene) {
  const old = scene.getObjectByName('__cropHelper__');
  if (old) scene.remove(old);
}
