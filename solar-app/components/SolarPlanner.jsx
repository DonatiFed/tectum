'use client';
import { useState } from 'react';
import { MODELS } from '@/lib/catalog';
import { store, useStore } from '@/lib/store';
import Scene from './Scene';
import Sidebar from './Sidebar';
import TemplatesPanel from './TemplatesPanel';
import DebugHUD from './DebugHUD';
import CropOverlay from './CropOverlay';
import EraseOverlay from './EraseOverlay';
import SelectOverlay from './SelectOverlay';
import PolygonOverlay from './PolygonOverlay';
import PickOverlay from './PickOverlay';
import RotationPad from './RotationPad';

export default function SolarPlanner() {
  const selectedModel = useStore(s => s.selectedModel);

  if (!selectedModel) return <ModelSelectScreen />;
  return <PlannerView />;
}

function ModelSelectScreen() {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 24, background: '#0d1b2a',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', color: '#f5a623', marginBottom: 6 }}>☀️ Solar Roof Planner</h1>
        <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>Select a 3D city model</p>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16,
        maxWidth: 520, width: '100%', padding: '0 16px',
      }}>
        {MODELS.map((m) => (
          <button
            key={m.file}
            onClick={() => store.set({ selectedModel: m, loaded: false, loadProgress: 0 })}
            style={{
              background: '#16213e', border: '1px solid #2a2a4a', borderRadius: 12,
              padding: '24px 16px', cursor: 'pointer', color: '#e0e0e0',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#f5a623'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2a2a4a'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <div style={{ fontSize: '2.2rem', marginBottom: 8 }}>{m.icon}</div>
            <div style={{ fontWeight: 600 }}>{m.name}</div>
            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: 4 }}>.glb</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PlannerView() {
  const loaded       = useStore(s => s.loaded);
  const progress     = useStore(s => s.loadProgress);
  const tab          = useStore(s => s.activeTab);
  const draftEditing = useStore(s => s.draftEditing);
  // Roof-detection action surface (mode buttons, drag overlays, rotation pad,
  // multi-select bar) shows on the Roof Detection tab AND whenever a draft
  // is open inside the Templates tab — so panels and roof tweaks live
  // side-by-side under one workspace.
  const detectUI = tab === 'detect' || draftEditing;

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Scene />
      {!loaded && <LoadingOverlay progress={progress} />}
      {loaded && <>
        <TopBar />
        <TabsBar />
        {tab === 'detect'    && <Sidebar />}
        {tab === 'templates' && <TemplatesPanel />}
        {detectUI && <BottomControls />}
        {detectUI && <SelectionActionBar />}
        <DebugHUD />
        {detectUI && <CropOverlay />}
        {detectUI && <SelectOverlay />}
        {detectUI && <PolygonOverlay />}
        {detectUI && <PickOverlay />}
        {detectUI && <EraseOverlay />}
        {detectUI && <RotationPad />}
        <HintBar />
      </>}
    </div>
  );
}

function LoadingOverlay({ progress }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(13,27,42,0.95)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 100,
    }}>
      <div className="spinner" />
      <div style={{ color: '#f5a623', fontSize: '1.1rem' }}>Loading model… {Math.round(progress * 100)}%</div>
    </div>
  );
}

function TopBar() {
  const model        = useStore(s => s.selectedModel);
  const modelVisible = useStore(s => s.modelVisible);
  const texturesOn   = useStore(s => s.texturesOn);
  const roofs        = useStore(s => s.roofs.length);
  const draftEditing = useStore(s => s.draftEditing);
  const dispatch = (n) => window.dispatchEvent(new CustomEvent(n));
  return (
    <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8, zIndex: 30, alignItems: 'center' }}>
      <button
        onClick={() => store.set({
          selectedModel: null, loaded: false, roofs: [], activeRoofId: null,
          cropBounds: null, mode: 'orbit',
        })}
        style={btnStyle('secondary')}
      >← Back</button>
      <div style={{
        background: 'rgba(22,33,62,0.85)', border: '1px solid #2a2a4a',
        borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem', color: '#aaa',
      }}>{model?.name}</div>
      {/* 3D + Texture toggles live up here so they're reachable from every
          tab (incl. Templates), not buried in the detection bottom dock. */}
      <button
        onClick={() => store.set(s => ({ modelVisible: !s.modelVisible, hint: !s.modelVisible ? '3D model visible' : '3D model hidden · only roof masks & panels remain' }))}
        style={{
          ...btnStyle('secondary'),
          background: modelVisible ? '#2a2a4a' : '#f5a623',
          color: modelVisible ? '#e0e0e0' : '#1a1a2e',
          border: 'none', fontWeight: 700,
        }}
        title="Show or hide the 3D building model"
      >{modelVisible ? '3D On' : '3D Off'}</button>
      <button
        onClick={() => store.set(s => ({ texturesOn: !s.texturesOn, hint: !s.texturesOn ? 'Textures on' : 'Textures off · plain shading reveals roof faces clearly' }))}
        style={{
          ...btnStyle('secondary'),
          background: texturesOn ? '#2a2a4a' : '#f5a623',
          color: texturesOn ? '#e0e0e0' : '#1a1a2e',
          border: 'none', fontWeight: 700,
        }}
        title="Show or hide building textures"
      >{texturesOn ? 'Tex On' : 'Tex Off'}</button>
      {/* Clear the live workspace (roofs, panels, selection, active draft).
          Saved templates + drafts remain in the library. Disabled when the
          scene already has nothing on it. */}
      <button
        onClick={() => {
          if (!roofs && !draftEditing) return;
          if (window.confirm('Clear the workspace? Saved templates and drafts will be kept; only the in-scene roofs and panels are removed.')) {
            dispatch('workspace:clear');
          }
        }}
        disabled={!roofs && !draftEditing}
        style={{
          ...btnStyle('secondary'),
          background: 'transparent',
          border: '1px solid #4a2030',
          color: '#ff8a8a', fontWeight: 700,
          opacity: (roofs || draftEditing) ? 1 : 0.4,
          cursor:  (roofs || draftEditing) ? 'pointer' : 'not-allowed',
        }}
        title="Clear the live workspace · saved templates and drafts are kept"
      >🧹 Clear Workspace</button>
    </div>
  );
}

// Top-centre tab strip — switches the right-hand sidebar between the three
// workspaces. Detection mode controls + drag overlays only render on the
// 'detect' tab (see PlannerView), so the other tabs feel like calm,
// dedicated screens.
function TabsBar() {
  const tab = useStore(s => s.activeTab);
  const templates = useStore(s => s.templates.length);
  const drafts    = useStore(s => s.drafts.length);
  const TABS = [
    { id: 'detect',    label: '🏠 Roof Detection', hint: 'Detect, clean and merge roof planes from the 3D model' },
    { id: 'templates', label: `📁 Templates${templates ? ` (${templates}${drafts ? ` · ${drafts}d` : ''})` : ''}`, hint: 'Save client templates and fork them into panel-layout drafts' },
  ];
  return (
    <div style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', gap: 4, zIndex: 30,
      background: 'rgba(10,18,34,0.92)', border: '1px solid #38506d',
      borderRadius: 999, padding: 4, boxShadow: '0 10px 24px rgba(0,0,0,0.4)',
    }}>
      {TABS.map(t => {
        const active = t.id === tab;
        return (
          <button key={t.id}
            onClick={() => store.set({ activeTab: t.id, hint: t.hint })}
            title={t.hint}
            style={{
              background: active ? '#f5a623' : 'transparent',
              color: active ? '#0d1b2a' : '#cbd5e1',
              border: 'none', borderRadius: 999,
              padding: '6px 14px', fontSize: '0.78rem', fontWeight: 700,
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >{t.label}</button>
        );
      })}
    </div>
  );
}

function BottomControls() {
  const dispatch = (name, detail) => window.dispatchEvent(new CustomEvent(name, detail !== undefined ? { detail } : undefined));
  const mode         = useStore(s => s.mode);
  const meshSmooth   = useStore(s => s.meshSmoothLevel);
  const activeRoofId = useStore(s => s.activeRoofId);
  const [open, setOpen] = useState(true);

  // Centered along the bottom of the *visible canvas* (viewport minus the
  // 320px right sidebar).
  const wrapStyle = {
    position: 'fixed',
    bottom: 18,
    left: 'calc((100% - 320px) / 2)',
    transform: 'translateX(-50%)',
    zIndex: 45,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
  };

  if (!open) {
    return (
      <div style={wrapStyle}>
        <button
          onClick={() => setOpen(true)}
          title="Show controls"
          style={{
            background: 'rgba(10,18,34,0.96)', border: '1px solid #38506d',
            color: '#f5a623', borderRadius: 999, padding: '8px 18px',
            fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 10px 24px rgba(0,0,0,0.45)',
          }}
        >▲ Controls</button>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <button
        onClick={() => setOpen(false)}
        title="Hide controls"
        style={{
          background: 'rgba(10,18,34,0.96)', border: '1px solid #38506d',
          color: '#9ca3af', borderRadius: 999, padding: '2px 14px',
          fontSize: '0.7rem', cursor: 'pointer',
        }}
      >▼ Hide</button>
      <div style={{
        display: 'flex', gap: 10, background: 'rgba(10,18,34,0.96)', border: '1px solid #38506d',
        borderRadius: 16, padding: '10px 14px', alignItems: 'center', flexWrap: 'wrap',
        boxShadow: '0 14px 40px rgba(0,0,0,0.45)',
        maxWidth: 'min(720px, calc(100vw - 360px))',
      }}>
        <ControlGroup label="Mode">
          <ModeCtl id="orbit" current={mode}>View</ModeCtl>
          <ModeCtl id="crop" current={mode}>Crop</ModeCtl>
          <ModeCtl id="select" current={mode}>Select</ModeCtl>
          <ModeCtl id="polygon" current={mode}>Polygon</ModeCtl>
          <ModeCtl id="pick" current={mode}>Pick</ModeCtl>
          <ModeCtl id="erase" current={mode}>Erase</ModeCtl>
        </ControlGroup>
        <ControlGroup label="Zoom">
          <button onClick={() => dispatch('cam:zoom', 'in')}  style={btnStyle('ctl')} title="Zoom in (or scroll)">＋</button>
          <button onClick={() => dispatch('cam:zoom', 'out')} style={btnStyle('ctl')} title="Zoom out (or scroll)">－</button>
        </ControlGroup>
        <ControlGroup label="View">
          <button onClick={() => dispatch('cam:reset')} style={btnStyle('ctl')}>Reset</button>
          <button onClick={() => dispatch('cam:top')}   style={btnStyle('ctl')}>Top</button>
          <button onClick={() => dispatch('cam:persp')} style={{ ...btnStyle('ctl'), background: '#f5a623', color: '#11203a', fontWeight: 800 }}>45°</button>
        </ControlGroup>
        <button
          onClick={() => dispatch('mask:smooth')}
          disabled={!activeRoofId}
          style={{ ...btnStyle('ctl'), opacity: activeRoofId ? 1 : 0.4, cursor: activeRoofId ? 'pointer' : 'not-allowed' }}
          title="Sharpen and smooth ONLY the outline of the active roof's mask"
        >✨ Smooth Edges</button>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '0 6px', borderLeft: '1px solid #2a2a4a' }}>
          <input
            type="range" min="0" max="1" step="0.02" value={meshSmooth}
            onChange={(e) => store.set({ meshSmoothLevel: +e.target.value })}
            style={{ width: 130, accentColor: '#f5a623' }}
            title="Surface Smoothness — 0 = original geometry, 1 = maximum flattening"
          />
          <div style={{ fontSize: '0.6rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Surface Smoothness · {Math.round(meshSmooth * 100)}%
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlGroup({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ display: 'flex', gap: 4 }}>{children}</div>
      <div style={{ fontSize: '0.6rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  );
}

function ModeCtl({ id, current, children }) {
  const active = id === current;
  return (
    <button
      onClick={() => store.set({ mode: id, hint: modeHint(id) })}
      style={{
        ...btnStyle('ctl'),
        background: active ? '#4ade80' : '#2a2a4a',
        color: active ? '#0d1b2a' : '#e0e0e0',
      }}
    >{children}</button>
  );
}

function modeHint(mode) {
  if (mode === 'crop') return 'Crop mode · drag a rectangle around the building · the view stays put when you apply';
  if (mode === 'select') return 'Drag Select mode · drag across the roof area to detect continuous roof planes';
  if (mode === 'polygon') return 'Polygon mode · click corners on the building · double-click or press Finish to create the roof';
  if (mode === 'pick') return 'Pick mode · drag a rectangle to select every roof inside it · hold Shift to add to current selection';
  if (mode === 'erase') return 'Erase mode · click a roof to delete it · or drag across roof outlines to erase every roof your stroke crosses';
  return 'View mode · drag to pan · scroll to zoom · click a roof to highlight · shift-click to multi-select';
}

function SelectionActionBar() {
  const ids = useStore(s => s.selectedRoofIds);
  const total = useStore(s => s.roofs.length);
  if (!ids || ids.length === 0) return null;
  const dispatch = (name) => window.dispatchEvent(new CustomEvent(name));
  const others = total - ids.length;
  return (
    <div style={{
      position: 'fixed', top: 14, left: 'calc((100% - 320px) / 2)', transform: 'translateX(-50%)',
      zIndex: 46, display: 'flex', gap: 8, alignItems: 'center',
      background: 'rgba(10,18,34,0.96)', border: '1px solid #a855f7',
      borderRadius: 999, padding: '6px 12px',
      boxShadow: '0 14px 40px rgba(0,0,0,0.45)',
    }}>
      <span style={{ color: '#d8b4fe', fontSize: '0.8rem', fontWeight: 700 }}>
        {ids.length} selected
      </span>
      <button
        onClick={() => dispatch('roofs:merge')}
        disabled={ids.length < 2}
        style={{
          background: ids.length >= 2 ? '#a855f7' : '#2a2a4a',
          color: ids.length >= 2 ? '#0d1b2a' : '#666',
          border: 'none', borderRadius: 999, padding: '6px 14px',
          fontSize: '0.78rem', fontWeight: 700,
          cursor: ids.length >= 2 ? 'pointer' : 'not-allowed',
        }}
        title="Merge selected roofs into one filled contour"
      >⊕ Merge</button>
      <button
        onClick={() => dispatch('roofs:deleteSelected')}
        style={{
          background: '#e74c3c', color: '#fff',
          border: 'none', borderRadius: 999, padding: '6px 14px',
          fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
        }}
        title="Delete selected roofs"
      >✕ Delete</button>
      <button
        onClick={() => dispatch('roofs:keepSelected')}
        disabled={others <= 0}
        style={{
          background: others > 0 ? '#0d1b2a' : '#2a2a4a',
          color: others > 0 ? '#d8b4fe' : '#666',
          border: `1px solid ${others > 0 ? '#a855f7' : '#38506d'}`,
          borderRadius: 999, padding: '6px 14px',
          fontSize: '0.78rem', fontWeight: 700,
          cursor: others > 0 ? 'pointer' : 'not-allowed',
        }}
        title="Delete every roof that isn't selected"
      >⌫ Keep only{others > 0 ? ` (drop ${others})` : ''}</button>
      <button
        onClick={() => store.set({ selectedRoofIds: [], hint: 'Selection cleared' })}
        style={{
          background: 'transparent', color: '#9ca3af',
          border: '1px solid #38506d', borderRadius: 999,
          padding: '4px 10px', fontSize: '0.74rem', cursor: 'pointer',
        }}
      >Clear</button>
    </div>
  );
}

function HintBar() {
  const hint = useStore(s => s.hint);
  return (
    <div style={{
      position: 'absolute', top: 64, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(22,33,62,0.92)', border: '1px solid #2a2a4a', borderRadius: 20,
      padding: '8px 20px', fontSize: '0.78rem', color: '#cbd5e1', pointerEvents: 'none', zIndex: 30,
      maxWidth: '70%', textAlign: 'center',
    }}>{hint}</div>
  );
}

export function btnStyle(variant) {
  const base = {
    border: 'none', borderRadius: 8, padding: '8px 14px',
    cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', color: '#e0e0e0',
    transition: 'opacity 0.15s',
  };
  if (variant === 'primary')   return { ...base, background: '#f5a623', color: '#1a1a2e' };
  if (variant === 'danger')    return { ...base, background: '#e74c3c', color: '#fff' };
  if (variant === 'secondary') return { ...base, background: '#16213e', border: '1px solid #2a2a4a' };
  if (variant === 'ctl')       return { ...base, background: '#2a2a4a', padding: '8px 12px', minHeight: 40, whiteSpace: 'nowrap' };
  return base;
}
