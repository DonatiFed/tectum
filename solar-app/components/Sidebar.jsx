'use client';
import { useState } from 'react';
import { store, useStore } from '@/lib/store';
import { btnStyle } from './SolarPlanner';

export default function Sidebar() {
  const [open, setOpen] = useState(true);
  const mode      = useStore(s => s.mode);
  const roofs      = useStore(s => s.roofs);
  const activeId   = useStore(s => s.activeRoofId);
  const cropBounds = useStore(s => s.cropBounds);
  const selectedIds = useStore(s => s.selectedRoofIds);
  const activeRoof = roofs.find(r => r.id === activeId);
  const cutCount = activeRoof?.plane?.cutOps ?? 0;
  const toggleSel = (id) => store.set(s => ({
    selectedRoofIds: s.selectedRoofIds.includes(id)
      ? s.selectedRoofIds.filter(x => x !== id)
      : [...s.selectedRoofIds, id],
  }));

  const totalArea = roofs.reduce((s, r) => s + r.plane.area, 0).toFixed(1);

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ position: 'absolute', top: 12, right: 12, zIndex: 30, ...btnStyle('primary') }}
      >{open ? '✕ Close' : '⚙ Panel'}</button>

      <aside style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, width: 320,
        background: 'rgba(22,33,62,0.95)', backdropFilter: 'blur(8px)',
        borderLeft: '1px solid #2a2a4a', overflowY: 'auto', zIndex: 25,
        padding: '60px 16px 16px', display: 'flex', flexDirection: 'column', gap: 16,
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s ease',
      }}>

        <Section title="Workflow">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <ModeBtn id="orbit"  current={mode}>🖱 Navigate</ModeBtn>
            <ModeBtn id="crop"   current={mode}>✂ Crop</ModeBtn>
            <ModeBtn id="select" current={mode}>🏠 Roof</ModeBtn>
            <ModeBtn id="erase"  current={mode}>✏ Erase</ModeBtn>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#888', marginTop: 4 }}>
            Crop a building · Drag across roof areas to segment continuous planes · Merge selected planes into one mask · Erase occlusions. When the roofs look right, switch to the <b>Templates</b> tab to save them as a client template.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {cropBounds && (
              <button onClick={() => window.dispatchEvent(new CustomEvent('crop:clear'))}
                style={{ ...btnStyle('secondary'), padding: '6px 8px', fontSize: '0.75rem' }}>⨉ Clear Crop</button>
            )}
            <button onClick={() => store.set({ activeRoofId: null, hint: 'Started fresh · next click creates a new roof' })}
              style={{ ...btnStyle('secondary'), padding: '6px 8px', fontSize: '0.75rem' }}>➕ New Roof</button>
          </div>
        </Section>

        <Divider />

        <Section title="Detected Roof Planes">
          {roofs.length === 0
            ? <div style={{ fontSize: '0.78rem', color: '#666' }}>Drag across a roof in Drag Select mode…</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                {roofs.map((r, i) => {
                  const isSel = selectedIds.includes(r.id);
                  const isActive = activeId === r.id;
                  return (
                  <div key={r.id}
                    onClick={() => store.set({ activeRoofId: r.id, hint: `Highlighted Roof ${i+1}` })}
                    style={{
                      background: isActive ? '#1f2d4a' : (isSel ? '#231539' : '#0f172a'),
                      border: `2px solid ${isActive ? '#f5a623' : (isSel ? '#a855f7' : '#2a2a4a')}`,
                      borderRadius: 6, padding: '8px 10px', fontSize: '0.78rem', cursor: 'pointer',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6,
                      color: isActive ? '#f5a623' : (isSel ? '#d8b4fe' : '#e0e0e0'),
                      boxShadow: isActive ? '0 0 0 1px #f5a623 inset' : (isSel ? '0 0 0 1px #a855f7 inset' : 'none'),
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSel(r.id)}
                      style={{ accentColor: '#a855f7', cursor: 'pointer' }}
                      title="Select for merge"
                    />
                    <span style={{ flex: 1 }}>Roof {i+1} · {r.plane.area.toFixed(1)} m² · {r.plane.tilt.toFixed(0)}°</span>
                    <span style={{ color: '#aaa' }}>{r.panels.length}p</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        store.set(s => ({
                          roofs: s.roofs.filter(x => x.id !== r.id),
                          activeRoofId: s.activeRoofId === r.id ? null : s.activeRoofId,
                          selectedRoofIds: (s.selectedRoofIds ?? []).filter(id => id !== r.id),
                          hint: `Deleted Roof ${i+1}`,
                        }));
                      }}
                      title="Delete this roof"
                      style={{
                        background: 'transparent', border: '1px solid #4a2030',
                        color: '#ff7070', borderRadius: 6, padding: '2px 8px',
                        fontSize: '0.78rem', cursor: 'pointer', fontWeight: 700,
                      }}
                    >✕</button>
                  </div>
                  );
                })}
              </div>
            )
          }
          {activeRoof && (
            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              <button
                disabled={selectedIds.length < 2}
                onClick={() => window.dispatchEvent(new CustomEvent('roofs:merge'))}
                style={{ ...btnStyle('secondary'), padding: '6px 8px', fontSize: '0.75rem',
                  background: selectedIds.length >= 2 ? '#a855f7' : undefined,
                  color: selectedIds.length >= 2 ? '#0d1b2a' : undefined,
                  opacity: selectedIds.length >= 2 ? 1 : 0.4,
                  cursor: selectedIds.length >= 2 ? 'pointer' : 'not-allowed' }}
                title="Tick ≥2 roofs above, then merge into one clean polygon"
              >⊕ Merge {selectedIds.length || ''} Selected</button>
              <button
                disabled={cutCount === 0}
                onClick={() => window.dispatchEvent(new CustomEvent('erase:clear'))}
                style={{ ...btnStyle('secondary'), padding: '6px 8px', fontSize: '0.75rem',
                  opacity: cutCount ? 1 : 0.4, cursor: cutCount ? 'pointer' : 'not-allowed' }}
              >↺ Reset Cut</button>
            </div>
          )}
        </Section>

        <Divider />

        <Section title="Summary">
          <InfoBox rows={[
            ['Roofs',          roofs.length],
            ['Roof area',      `${totalArea} m²`],
            ['Selected',       selectedIds.length],
          ]} />
        </Section>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            disabled={selectedIds.length === 0}
            onClick={() => store.set({ activeTab: 'templates', hint: 'Templates tab \u00b7 save the current selection as a client template, then expand it to fork drafts' })}
            style={{ ...btnStyle('primary'), flex: 1, minWidth: 130,
              opacity: selectedIds.length ? 1 : 0.4,
              cursor: selectedIds.length ? 'pointer' : 'not-allowed' }}
            title="Jump to the Templates tab to save the selected roofs as a new client template"
          >📁 Save as Template…</button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('roofs:clearAll'))}
            style={{ ...btnStyle('danger'), flex: 1, minWidth: 100 }}
          >Clear All</button>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888' }}>{title}</div>
      {children}
    </div>
  );
}

function Divider() { return <div style={{ height: 1, background: '#2a2a4a' }} />; }

function InfoBox({ rows }) {
  return (
    <div style={{ background: '#0f172a', border: '1px solid #2a2a4a', borderRadius: 8, padding: 12, fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#888' }}>{k}</span>
          <span style={{ color: '#f5a623', fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function ModeBtn({ id, current, children }) {
  const active = id === current;
  return (
    <button
      onClick={() => store.set({ mode: id, hint: hintForMode(id) })}
      style={{
        ...btnStyle('secondary'), flex: 1, minWidth: 80,
        background: active ? '#f5a623' : '#2a2a4a',
        color: active ? '#1a1a2e' : '#e0e0e0',
        border: 'none',
      }}
    >{children}</button>
  );
}

function hintForMode(m) {
  if (m === 'crop')   return "Crop mode: top-down view will activate · drag a rectangle over a building";
  if (m === 'select') return 'Drag Select mode: drag a rectangle across the roof area to detect every continuous plane in that area';
  if (m === 'erase')  return 'Erase mode: draw a stroke across the active roof to cut that area out (brush ~0.6 m)';
  return 'View mode: camera movement is done only with the visible on-screen buttons';
}
