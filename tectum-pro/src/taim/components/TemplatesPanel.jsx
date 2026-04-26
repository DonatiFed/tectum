'use client';
import { useEffect, useState } from 'react';
import { store, useStore } from '../lib/store';
import { PANEL_TYPES } from '../lib/catalog';
import { specificYield } from '../lib/solar';
import { btnStyle } from './SolarPlanner';

// Single Templates tab. Two display modes:
//   1) Overview  — list of saved templates, each expandable into a dropdown
//      whose first row is "+ New Draft" and whose remaining rows are the
//      saved drafts under that template.
//   2) Editor    — once any draft (new or saved) is opened, the panel flips
//      to the panel-design editor. Roof-detection action buttons + drag
//      overlays are also surfaced (PlannerView gates them on draftEditing)
//      so panels and roof tweaks happen side-by-side.
export default function TemplatesPanel() {
  const open = useStore(s => s.sidebarOpen);
  const setOpen = (v) => store.set(typeof v === 'function'
    ? (s) => ({ sidebarOpen: v(s.sidebarOpen) })
    : { sidebarOpen: v });
  const draftEditing    = useStore(s => s.draftEditing);
  const selectedPanelKeys = useStore(s => s.selectedPanelKeys);
  const showPanelPopup = draftEditing && selectedPanelKeys.length === 1;

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ position: 'absolute', top: 12, right: 12, zIndex: 30, ...btnStyle('primary') }}
      >{open ? '✕ Close' : '⚙ Panel'}</button>

      <aside style={panelStyle(open)}>
        {draftEditing ? <DraftEditor /> : <TemplatesOverview />}
      </aside>

      {showPanelPopup && <SelectedPanelPopup />}
    </>
  );
}

// ── Overview ────────────────────────────────────────────────────────────
function TemplatesOverview() {
  const templates    = useStore(s => s.templates);
  const activeTplId  = useStore(s => s.activeTemplateId);
  const roofs        = useStore(s => s.roofs);
  const selectedIds  = useStore(s => s.selectedRoofIds);
  const drafts       = useStore(s => s.drafts);
  const pendingProjectName = useStore(s => s.pendingProjectName);
  const intake             = useStore(s => s.intake);
  // Pre-seed the template name with the project name carried over from the
  // import screen / Tectum intake form, so saving "Template for client X"
  // is a single click for the most common workflow.
  const [name, setName] = useState(pendingProjectName || '');
  useEffect(() => {
    if (pendingProjectName && !name) setName(pendingProjectName);
  }, [pendingProjectName]); // eslint-disable-line react-hooks/exhaustive-deps
  const [expanded, setExpanded] = useState(() => new Set(activeTplId ? [activeTplId] : []));
  const toggleExp = (id) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const subsetCount = selectedIds.length || roofs.length;
  const dispatch = (n, detail) => window.dispatchEvent(new CustomEvent(n, detail !== undefined ? { detail } : undefined));

  return (
    <>
      <Section title="Save current roofs as Template">
        <div style={{ fontSize: '0.74rem', color: '#9ca3af', lineHeight: 1.4 }}>
          Templates are the immutable BASE for a client. Detect & clean up
          roofs in the <b>Roof Detection</b> tab, then save the working set
          here as <i>“Template for Client X”</i>. Drafts forked from a
          template never modify it.
        </div>
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Template for Schmidt House"
          style={inputStyle}
        />
        <button
          onClick={() => {
            if (!subsetCount) return;
            dispatch('template:save', { name });
            setName('');
            store.set({ pendingProjectName: null });
          }}
          disabled={subsetCount === 0}
          style={{
            ...btnStyle('primary'),
            opacity: subsetCount ? 1 : 0.4,
            cursor: subsetCount ? 'pointer' : 'not-allowed',
          }}
          title="Snapshot the selected (or all) detected roofs into a new template"
        >💾 Save Template ({selectedIds.length ? `${selectedIds.length} selected` : `${roofs.length} roofs`})</button>
      </Section>

      <Divider />

      <Section title={`Templates (${templates.length})`}>
        {templates.length === 0
          ? <Empty msg="No templates yet — save your first one above." />
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {templates.map(t => {
                const isOpen    = expanded.has(t.id);
                const tplDrafts = drafts.filter(d => d.templateId === t.id);
                return (
                  <div key={t.id} style={{
                    background: '#0f172a', border: '2px solid #2a2a4a',
                    borderRadius: 8, overflow: 'hidden',
                  }}>
                    {/* Header — clicking expands/collapses the dropdown */}
                    <div style={{ display: 'flex', alignItems: 'stretch' }}>
                      <button
                        onClick={() => toggleExp(t.id)}
                        style={{
                          background: 'transparent', border: 'none', flex: 1,
                          padding: '10px 12px', cursor: 'pointer', textAlign: 'left',
                          color: '#e0e0e0',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#f5a623' }}>
                            {isOpen ? '▾' : '▸'} {t.name}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: '#888' }}>🔒 base</span>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 4 }}>
                          {t.roofs.length} roof{t.roofs.length === 1 ? '' : 's'} · {tplDrafts.length} draft{tplDrafts.length === 1 ? '' : 's'} · {timeAgo(t.createdAt)}
                        </div>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const msg = tplDrafts.length
                            ? `Delete template "${t.name}"? This will also delete its ${tplDrafts.length} draft${tplDrafts.length===1?'':'s'}. This cannot be undone.`
                            : `Delete template "${t.name}"? This cannot be undone.`;
                          if (window.confirm(msg)) dispatch('template:delete', { id: t.id });
                        }}
                        title={tplDrafts.length
                          ? `Delete template (and ${tplDrafts.length} draft${tplDrafts.length===1?'':'s'})`
                          : 'Delete template'}
                        style={{
                          background: 'transparent', border: 'none',
                          color: '#ff7070', padding: '0 14px',
                          fontSize: '0.95rem', cursor: 'pointer', fontWeight: 700,
                          borderLeft: '1px solid #2a2a4a',
                        }}
                      >🗑</button>
                    </div>
                    {isOpen && (
                      <div style={{ borderTop: '1px solid #2a2a4a', display: 'flex', flexDirection: 'column' }}>
                        {/* Top row — start a fresh draft from this template */}
                        <button
                          onClick={() => dispatch('draft:new', { templateId: t.id })}
                          style={dropdownRow({ accent: '#4ade80', strong: true })}
                          title="Fork a fresh draft from this template"
                        >
                          <span>＋ New Draft</span>
                          <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>start from base</span>
                        </button>
                        {tplDrafts.length === 0 ? (
                          <div style={{ padding: '8px 12px', fontSize: '0.72rem', color: '#666', borderTop: '1px solid #1a2540' }}>
                            No saved drafts yet — “New Draft” opens the editor.
                          </div>
                        ) : tplDrafts.map(d => {
                          const total = Object.values(d.panelsByRoof ?? {}).reduce((s, ps) => s + ps.length, 0);
                          const wp = PANEL_TYPES[d.settings?.panelTypeIdx ?? 0]?.wp ?? 0;
                          const kWp = (total * wp / 1000).toFixed(2);
                          return (
                            <div key={d.id} style={{
                              display: 'flex', alignItems: 'stretch',
                              borderTop: '1px solid #1a2540',
                            }}>
                              <button
                                onClick={() => dispatch('draft:load', { id: d.id })}
                                style={{ ...dropdownRow({ accent: '#a855f7' }), flex: 1 }}
                                title="Open this draft in the editor"
                              >
                                <span>📄 {d.name}</span>
                                <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>
                                  {total}p · {kWp} kWp · {(d.settings?.panelAngleDeg ?? 0).toFixed(0)}°
                                </span>
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); dispatch('draft:delete', { id: d.id }); }}
                                title="Delete this draft (template is unaffected)"
                                style={{
                                  background: 'transparent', border: 'none',
                                  color: '#ff7070', padding: '0 12px',
                                  fontSize: '0.9rem', cursor: 'pointer', fontWeight: 700,
                                }}
                              >✕</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        }
      </Section>
    </>
  );
}

// ── Editor (open draft) ─────────────────────────────────────────────────
function DraftEditor() {
  const templates    = useStore(s => s.templates);
  const drafts       = useStore(s => s.drafts);
  const activeTplId  = useStore(s => s.activeTemplateId);
  const activeDfId   = useStore(s => s.activeDraftId);
  const roofs        = useStore(s => s.roofs);
  const activeId     = useStore(s => s.activeRoofId);
  const selectedIds  = useStore(s => s.selectedRoofIds);
  const panelIdx     = useStore(s => s.panelTypeIdx);
  const panelScale   = useStore(s => s.panelScale);
  const panelGap     = useStore(s => s.panelGap);
  const panelAngle   = useStore(s => s.panelAngleDeg);
  const autoAlign    = useStore(s => s.panelAutoAlign);
  const surfaceLift  = useStore(s => s.panelSurfaceOffset);
  const landscape    = useStore(s => s.panelLandscape);
  const solarLat     = useStore(s => s.solarLatitude);
  const tiltDeg      = useStore(s => s.panelTiltDeg);
  const customPanel  = useStore(s => s.customPanel);
  const clipboard    = useStore(s => s.panelClipboard);
  const panelsVisible = useStore(s => s.panelsVisible);
  const panelOpacity  = useStore(s => s.panelOpacity);
  const [draftName, setDraftName] = useState('');

  const isCustom = panelIdx === -1;
  const panel    = isCustom ? customPanel : PANEL_TYPES[panelIdx];
  const tpl   = templates.find(t => t.id === activeTplId);
  const draft = drafts.find(d => d.id === activeDfId);
  const totalPanels = roofs.reduce((s, r) => s + (r.panels?.length ?? 0), 0);
  const totalKwp = roofs.reduce((sum, r) => {
    const wp = r.panelSpec?.wp ?? panel.wp;
    return sum + (r.panels?.length ?? 0) * wp / 1000;
  }, 0).toFixed(2);
  const totalAnnualKwh = roofs.reduce((sum, r) => {
    const wp = r.panelSpec?.wp ?? panel.wp;
    return sum + (r.panels?.length ?? 0) * wp / 1000 * specificYield(solarLat);
  }, 0);
  const dispatch = (n, detail) => window.dispatchEvent(new CustomEvent(n, detail !== undefined ? { detail } : undefined));

  const targets = selectedIds.length || (activeId ? 1 : 0);
  const targetLabel = selectedIds.length
    ? `${selectedIds.length} selected`
    : (activeId ? 'active roof' : 'no target');

  return (
    <>
      <Section title="Editing draft">
        <button
          onClick={() => dispatch('draft:close')}
          style={{ ...btnStyle('secondary'), fontSize: '0.75rem', padding: '6px 8px', alignSelf: 'flex-start' }}
          title="Close the editor and return to the templates list"
        >← Back to templates</button>
        <div style={{
          background: '#0f172a', border: '1px solid #2a2a4a', borderRadius: 8,
          padding: 10, fontSize: '0.8rem', color: '#e0e0e0',
        }}>
          <div><span style={{ color: '#888' }}>Template:</span> <b style={{ color: '#f5a623' }}>{tpl?.name ?? '—'}</b> 🔒</div>
          <div style={{ marginTop: 4 }}>
            <span style={{ color: '#888' }}>Draft:</span>{' '}
            {draft
              ? <b style={{ color: '#a855f7' }}>{draft.name}</b>
              : <span style={{ color: '#a855f7', fontStyle: 'italic' }}>New draft (unsaved)</span>}
          </div>
        </div>
        <button
          onClick={() => activeTplId && dispatch('template:load', { id: activeTplId })}
          style={{ ...btnStyle('secondary'), fontSize: '0.75rem', padding: '6px 8px' }}
          title="Discard the in-scene panels and reload the locked template base"
        >↺ Reset to template base</button>
        <div style={{ fontSize: '0.72rem', color: '#9ca3af', lineHeight: 1.4 }}>
          The roof-detection action buttons (View / Crop / Select / Polygon /
          Pick / Erase) and the camera dock are visible at the bottom while
          this draft is open — tweak the roofs for this proposal without
          touching the locked template.
        </div>
      </Section>

      <Divider />

      <Section title="Summary">
        <InfoBox rows={[
          ['Roofs',         roofs.length],
          ['Panels',        totalPanels],
          ['Total kWp',     `${totalKwp} kWp`],
          ['Annual yield',  `~${Math.round(totalAnnualKwh).toLocaleString()} kWh/a`],
          ['New panels',    isCustom ? `Custom · ${panel.w}×${panel.h} m · ${panel.wp} Wp` : `${panel.brand} ${panel.model} (${panel.wp} Wp)`],
          ['Rotation',      `${panelAngle.toFixed(0)}°`],
        ]} />
      </Section>

      <Divider />

      <Section title="Production by roof">
        {roofs.length === 0
          ? <div style={{ fontSize: '0.72rem', color: '#666' }}>No roofs yet.</div>
          : roofs.map((r, i) => {
            const spec = r.panelSpec;
            const np   = r.panels?.length ?? 0;
            const kWp  = spec ? (np * spec.wp / 1000) : (np * panel.wp / 1000);
            const kwh  = kWp * specificYield(solarLat);
            const specName = spec
              ? (spec.brand ? `${spec.brand} ${spec.model}` : 'Custom')
              : (isCustom ? 'Custom' : `${panel.brand} ${panel.model}`);
            return (
              <div key={r.id} style={{
                background: '#0f172a', border: '1px solid #2a2a4a',
                borderRadius: 6, padding: '8px 10px', fontSize: '0.75rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ color: '#f5a623', fontWeight: 700 }}>Roof {i + 1}</span>
                  <span style={{ color: '#888' }}>{r.plane.area.toFixed(1)} m² · {r.plane.tilt.toFixed(0)}°</span>
                </div>
                {np === 0 ? (
                  <span style={{ color: '#555', fontStyle: 'italic' }}>No panels placed</span>
                ) : (
                  <>
                    <div style={{ color: '#60a5fa', fontSize: '0.7rem', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{specName}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                      <span>{np} panels &nbsp;·&nbsp; {kWp.toFixed(2)} kWp</span>
                      <span style={{ color: '#4ade80', fontWeight: 700 }}>~{Math.round(kwh).toLocaleString()} kWh/a</span>
                    </div>
                  </>
                )}
              </div>
            );
          })
        }
      </Section>

      <Divider />

      <Section title="Panel type">
        <PanelCatalogue selected={panelIdx} onChange={i => store.set({ panelTypeIdx: i })} />
        {isCustom && (
          <div style={{
            marginTop: 6, padding: 10, background: '#0f172a',
            border: '1px solid #4ade80', borderRadius: 8,
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
          }}>
            <NumField label="Width m"  value={customPanel.w}  step={0.01} min={0.3}  max={3}
              onChange={v => store.set({ customPanel: { ...customPanel, w: v } })} />
            <NumField label="Height m" value={customPanel.h}  step={0.01} min={0.3}  max={3}
              onChange={v => store.set({ customPanel: { ...customPanel, h: v } })} />
            <NumField label="Power Wp" value={customPanel.wp} step={5}    min={50}   max={1500}
              onChange={v => store.set({ customPanel: { ...customPanel, wp: v } })} />
            <NumField label="Effic. %" value={customPanel.efficiency ?? 20} step={0.1} min={5} max={30}
              onChange={v => store.set({ customPanel: { ...customPanel, efficiency: v } })} />
            <NumField label="Weight kg" value={customPanel.weight_kg ?? 22} step={0.5} min={5} max={80}
              onChange={v => store.set({ customPanel: { ...customPanel, weight_kg: v } })} />
          </div>
        )}
      </Section>

      <Section title={`Rotation: ${autoAlign ? `${panelAngle >= 0 ? '+' : ''}${panelAngle.toFixed(0)}° on roof normal` : `${panelAngle.toFixed(0)}° on roof normal`}`}>
        <button
          onClick={() => store.set({ panelAutoAlign: !autoAlign, hint: !autoAlign ? 'Auto-align ON · roof edges set the base direction, angle still offsets around the roof normal' : 'Auto-align OFF · using only the manual roof-normal angle' })}
          style={{
            ...btnStyle('secondary'),
            background: autoAlign ? '#0d3b22' : '#2a2a4a',
            border: autoAlign ? '1px solid #4ade80' : '1px solid #2a2a4a',
            color: autoAlign ? '#bbf7d0' : '#e0e0e0',
            fontWeight: 700,
          }}
          title="When ON, the roof outline sets the base direction. The angle slider still adds a manual rotation around the roof plane normal."
        >🧭 Auto-align to roof edges: {autoAlign ? 'ON' : 'OFF'}</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => store.set({ panelAngleDeg: Math.max(-90, +(panelAngle - 5).toFixed(2)) })}
            style={nudgeBtn} title="-5°">◀</button>
          <input type="range" min="-90" max="90" step="1" value={panelAngle}
            onChange={e => store.set({ panelAngleDeg: +e.target.value })}
            style={{ flex: 1, accentColor: '#f5a623' }} />
          <button onClick={() => store.set({ panelAngleDeg: Math.min(90, +(panelAngle + 5).toFixed(2)) })}
            style={nudgeBtn} title="+5°">▶</button>
        </div>
        <div style={{ display: 'flex', gap: 4, fontSize: '0.7rem' }}>
          {[-90, -45, 0, 45, 90].map(a => (
            <button key={a}
              onClick={() => store.set({ panelAngleDeg: a })}
              style={{
                flex: 1, padding: '4px 0', borderRadius: 4, cursor: 'pointer',
                background: Math.round(panelAngle) === a ? '#f5a623' : '#2a2a4a',
                color:      Math.round(panelAngle) === a ? '#1a1a2e' : '#e0e0e0',
                border: 'none', fontWeight: 700,
              }}
            >{a > 0 ? `+${a}` : a}°</button>
          ))}
        </div>
        <div style={{ fontSize: '0.7rem', color: '#888' }}>
          The angle always rotates panels clockwise / counterclockwise around the roof plane normal. Auto-align only picks the starting direction from the roof edges.
        </div>
      </Section>

      <Section title="Orientation">
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => store.set({ panelLandscape: false, hint: 'Panels: portrait in the roof-aligned frame' })}
            style={{
              ...btnStyle('secondary'), flex: 1,
              background: !landscape ? '#f5a623' : '#2a2a4a',
              color:      !landscape ? '#1a1a2e' : '#e0e0e0',
              border: 'none', fontWeight: 700,
            }}
            title="Panel's long edge runs along the roof-aligned vertical grid axis"
          >↕ Portrait</button>
          <button
            onClick={() => store.set({ panelLandscape: true, hint: 'Panels: landscape in the roof-aligned frame' })}
            style={{
              ...btnStyle('secondary'), flex: 1,
              background: landscape ? '#f5a623' : '#2a2a4a',
              color:      landscape ? '#1a1a2e' : '#e0e0e0',
              border: 'none', fontWeight: 700,
            }}
            title="Panel's long edge runs along the roof-aligned horizontal grid axis"
          >↔ Landscape</button>
        </div>
      </Section>

      <Section title={`Panel scale: ${panelScale.toFixed(2)}×`}>
        <input type="range" min="0.3" max="3" step="0.05" value={panelScale}
          onChange={e => store.set({ panelScale: +e.target.value })} style={{ width: '100%', accentColor: '#f5a623' }} />
      </Section>

      <Section title={`Panel gap: ${panelGap.toFixed(2)} m`}>
        <input type="range" min="0" max="0.5" step="0.01" value={panelGap}
          onChange={e => store.set({ panelGap: +e.target.value })} style={{ width: '100%', accentColor: '#f5a623' }} />
      </Section>

      <Section title={`Lift above roof: ${(surfaceLift * 100).toFixed(0)} cm`}>
        <input type="range" min="0.02" max="0.5" step="0.01" value={surfaceLift}
          onChange={e => store.set({ panelSurfaceOffset: +e.target.value })} style={{ width: '100%', accentColor: '#f5a623' }} />
        <div style={{ fontSize: '0.7rem', color: '#888' }}>
          Hover height of the panel mesh above the roof surface — keeps panels visually distinct from the roof and matches typical mounting clearance.
        </div>
      </Section>

      <Section title={`Display · ${panelsVisible ? 'on' : 'off'} · ${Math.round(panelOpacity * 100)}%`}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <button
            onClick={() => store.set({ panelsVisible: !panelsVisible })}
            style={{ ...btnStyle(panelsVisible ? 'primary' : 'secondary'), flex: 1 }}
            title="Show or hide all panel meshes (does not delete them)"
          >{panelsVisible ? '◉ Panels visible' : '○ Panels hidden'}</button>
        </div>
        <input
          type="range" min="0.05" max="1" step="0.05" value={panelOpacity}
          onChange={e => store.set({ panelOpacity: +e.target.value })}
          style={{ width: '100%', accentColor: '#f5a623' }}
          disabled={!panelsVisible}
        />
        <div style={{ fontSize: '0.7rem', color: '#888' }}>
          Lower opacity to see the roof surface through the panels. Toggle off to inspect the bare roof without losing the layout.
        </div>
      </Section>

      <Section title={`Place / clear (${targetLabel})`}>
        <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: 4 }}>
          Tip: shift-click roofs in the scene to multi-select, then place
          the same layout on every selected roof at once.
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            disabled={!targets}
            onClick={() => dispatch('panels:place')}
            style={{ ...btnStyle('primary'), flex: 1, minWidth: 110, opacity: targets ? 1 : 0.4, cursor: targets ? 'pointer' : 'not-allowed' }}
          >▦ Place</button>
          <button
            disabled={!targets}
            onClick={() => dispatch('panels:clear')}
            style={{ ...btnStyle('secondary'), flex: 1, minWidth: 100, opacity: targets ? 1 : 0.4, cursor: targets ? 'pointer' : 'not-allowed' }}
          >✕ Clear</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            disabled={!activeId}
            onClick={() => dispatch('panels:copy')}
            style={{ ...btnStyle('secondary'), flex: 1, minWidth: 100, opacity: activeId ? 1 : 0.4, cursor: activeId ? 'pointer' : 'not-allowed' }}
            title="Copy the current panel recipe (type/orientation/scale/gap)"
          >⎘ Copy recipe</button>
          <button
            disabled={!clipboard || !targets}
            onClick={() => dispatch('panels:paste')}
            style={{
              ...btnStyle('secondary'), flex: 1, minWidth: 100,
              opacity: (clipboard && targets) ? 1 : 0.4,
              cursor:  (clipboard && targets) ? 'pointer' : 'not-allowed',
              background: clipboard ? '#0d3b22' : undefined,
              border: clipboard ? '1px solid #4ade80' : undefined,
              color: clipboard ? '#bbf7d0' : undefined,
            }}
            title="Apply the copied recipe to every targeted roof"
          >▶ Paste</button>
        </div>
      </Section>

      <Divider />

      <Section title="Save as draft">
        <input type="text" value={draftName}
          onChange={e => setDraftName(e.target.value)}
          placeholder={draft ? `e.g. ${draft.name} v2` : 'e.g. Max coverage, portrait'}
          style={inputStyle}
        />
        <button
          onClick={() => { dispatch('draft:save', { name: draftName }); setDraftName(''); }}
          style={{ ...btnStyle('primary') }}
          title="Snapshot the current panel layout + settings as a new draft under this template"
        >💾 Save as new draft</button>
      </Section>
    </>
  );
}

// ── Single-panel popup (floats over the canvas when exactly one panel is selected) ──
function SelectedPanelPopup() {
  const dispatch = (n, detail) => window.dispatchEvent(new CustomEvent(n, detail !== undefined ? { detail } : undefined));
  const rotateBtn = (delta, label) => (
    <button
      onClick={() => dispatch('panel:rotate', { delta })}
      style={{
        background: '#1a2a40',
        border: '1px solid #2a4060',
        color: '#f5a623',
        padding: '8px 10px',
        borderRadius: 8,
        cursor: 'pointer',
        fontWeight: 700,
        fontSize: '0.78rem',
        flex: 1,
        minWidth: 0,
      }}
      title={`Rotate panel ${delta > 0 ? '+' : ''}${delta}° around the roof normal`}
    >{label}</button>
  );
  return (
    <div
      style={{
        position: 'absolute',
        top: 70,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 40,
        background: 'rgba(15,23,42,0.96)',
        backdropFilter: 'blur(8px)',
        border: '1px solid #f5a623',
        borderRadius: 12,
        padding: '12px 14px',
        boxShadow: '0 18px 38px rgba(0,0,0,0.55)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: 360,
        maxWidth: 'calc(100vw - 360px)',
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8,
      }}>
        <span style={{
          fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em',
          color: '#f5a623', fontWeight: 800,
        }}>▣ Selected panel</span>
        <button
          onClick={() => store.set({ selectedPanelKeys: [], hint: 'Panel deselected' })}
          title="Close — deselect this panel"
          style={{
            background: 'transparent', border: 'none',
            color: '#9ca3af', cursor: 'pointer', fontSize: '1.05rem',
            fontWeight: 800, lineHeight: 1, padding: 2,
          }}
        >✕</button>
      </div>
      <div style={{ fontSize: '0.7rem', color: '#9ca3af', lineHeight: 1.4 }}>
        Drag the panel on the roof to reposition it · use the buttons below
        to rotate it on the spot.
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {rotateBtn(-15, '↺ −15°')}
        {rotateBtn(-5,  '↺ −5°')}
        {rotateBtn(+5,  '↻ +5°')}
        {rotateBtn(+15, '↻ +15°')}
      </div>
      <button
        onClick={() => dispatch('panel:deleteSelected')}
        style={{
          background: '#3b0d0d', border: '1px solid #ff7070',
          color: '#fecaca', padding: '8px 10px', borderRadius: 8,
          cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem',
        }}
        title="Delete this panel"
      >🗑 Delete panel</button>
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────
function panelStyle(open) {
  return {
    position: 'absolute', top: 0, right: 0, bottom: 0, width: 320,
    background: 'rgba(22,33,62,0.95)', backdropFilter: 'blur(8px)',
    borderLeft: '1px solid #2a2a4a', overflowY: 'auto', zIndex: 25,
    padding: '60px 16px 16px', display: 'flex', flexDirection: 'column', gap: 16,
    transform: open ? 'translateX(0)' : 'translateX(100%)',
    transition: 'transform 0.25s ease',
  };
}

function dropdownRow({ accent, strong }) {
  return {
    background: 'transparent', border: 'none', cursor: 'pointer',
    padding: '10px 12px', textAlign: 'left',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    color: strong ? accent : '#e0e0e0',
    fontWeight: strong ? 800 : 600, fontSize: '0.82rem',
  };
}

function OriBtn({ id, current, children }) {
  // (legacy) kept for reference — panels are now rotated continuously, see
  // the Rotation section in DraftEditor.
  const active = id === current;
  return (
    <button
      onClick={() => store.set({ panelAngleDeg: id === 'landscape' ? 90 : 0 })}
      style={{
        ...btnStyle('secondary'), flex: 1,
        background: active ? '#f5a623' : '#2a2a4a',
        color: active ? '#1a1a2e' : '#e0e0e0',
        border: 'none',
      }}
    >{children}</button>
  );
}

function NumField({ label, value, step, min, max, onChange }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.65rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <input type="number" value={value} step={step} min={min} max={max}
        onChange={e => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        style={{ ...inputStyle, padding: '5px 6px', fontSize: '0.78rem', width: '100%' }} />
    </label>
  );
}

const nudgeBtn = {
  width: 28, height: 28, borderRadius: 6,
  background: '#2a2a4a', color: '#f5a623', border: 'none',
  cursor: 'pointer', fontWeight: 800, fontSize: '0.85rem',
};

// ── Single-panel sandbox: click to select panels in the 3D scene, then
// delete or copy them; copying enables a drop mode where every click on
// the building drops a new panel with the same dimensions + angle.
function PanelSandbox() {
  const selectedKeys = useStore(s => s.selectedPanelKeys);
  const clipboard    = useStore(s => s.singlePanelClipboard);
  const mode         = useStore(s => s.mode);
  const dispatch = (n, detail) => window.dispatchEvent(new CustomEvent(n, detail !== undefined ? { detail } : undefined));
  const dropping = mode === 'panel-drop';
  return (
    <Section title={`Panel sandbox · ${selectedKeys.length} selected`}>
      <div style={{ fontSize: '0.7rem', color: '#888', lineHeight: 1.45 }}>
        Click a panel in the 3D view to select it · shift-click to add to
        the selection · then Delete or Copy. Copy + Drop lets you place
        more panels by clicking on the building.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          disabled={!selectedKeys.length}
          onClick={() => dispatch('panel:deleteSelected')}
          style={{
            ...btnStyle('secondary'), flex: 1, minWidth: 100,
            opacity: selectedKeys.length ? 1 : 0.4,
            cursor:  selectedKeys.length ? 'pointer' : 'not-allowed',
            background: selectedKeys.length ? '#3b0d0d' : undefined,
            border:     selectedKeys.length ? '1px solid #ff7070' : undefined,
            color:      selectedKeys.length ? '#fecaca' : undefined,
          }}
          title="Delete the selected panel(s)"
        >🗑 Delete</button>
        <button
          disabled={selectedKeys.length !== 1}
          onClick={() => dispatch('panel:copySelected')}
          style={{
            ...btnStyle('secondary'), flex: 1, minWidth: 100,
            opacity: selectedKeys.length === 1 ? 1 : 0.4,
            cursor:  selectedKeys.length === 1 ? 'pointer' : 'not-allowed',
          }}
          title="Copy this single panel as a drag-drop recipe"
        >⎘ Copy panel</button>
      </div>
      <button
        disabled={!clipboard}
        onClick={() => dispatch(dropping ? 'panel:exitDropMode' : 'panel:enterDropMode')}
        style={{
          ...btnStyle('primary'),
          opacity: clipboard ? 1 : 0.4,
          cursor:  clipboard ? 'pointer' : 'not-allowed',
          background: dropping ? '#4ade80' : undefined,
          color:      dropping ? '#0d1b2a' : undefined,
        }}
        title={clipboard
          ? 'Click on the building to drop more panels with the copied dimensions'
          : 'Copy a single panel first, then drop'}
      >{dropping ? '⏹ Stop dropping' : '✥ Drop new panel'}</button>
      {clipboard && (
        <div style={{
          fontSize: '0.7rem', color: '#9ca3af', padding: '6px 8px',
          background: '#0f172a', border: '1px solid #2a2a4a', borderRadius: 6,
        }}>
          Clipboard: {clipboard.w}×{clipboard.h} m · {clipboard.wp} Wp · {(clipboard.angleDeg ?? 0).toFixed(0)}°
        </div>
      )}
      {dropping && (
        <div style={{
          fontSize: '0.7rem', color: '#bbf7d0', padding: '6px 8px',
          background: '#0d3b22', border: '1px solid #4ade80', borderRadius: 6,
        }}>
          Drop mode active · click the building to place panels · Esc to stop
        </div>
      )}
    </Section>
  );
}

// ── Catalogue panel picker ───────────────────────────────────────────────
function PanelCatalogue({ selected, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
      {PANEL_TYPES.map((p, i) => {
        const active = selected === i;
        return (
          <div
            key={p.id}
            onClick={() => onChange(i)}
            style={{
              background: active ? '#1a2a40' : '#0f172a',
              border: `1.5px solid ${active ? '#f5a623' : '#2a2a4a'}`,
              borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'border-color 0.12s',
            }}
          >
            {/* Radio dot */}
            <div style={{
              width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
              background: active ? '#f5a623' : 'transparent',
              border: `2px solid ${active ? '#f5a623' : '#4a5568'}`,
            }} />

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '0.78rem', fontWeight: 700,
                color: active ? '#f5a623' : '#e0e0e0',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{p.brand} {p.model}</div>
              <div style={{ fontSize: '0.68rem', color: '#888', marginTop: 2 }}>
                <span style={{ fontFamily: 'monospace', color: '#4a6080', marginRight: 6 }}>{p.id.slice(0, 8)}</span>
                {p.wp} Wp &nbsp;·&nbsp; {p.w.toFixed(3)}×{p.h.toFixed(3)} m &nbsp;·&nbsp; {p.efficiency.toFixed(1)}%
              </div>
            </div>

            {/* Datasheet button */}
            {p.datasheetUrl && (
              <button
                onClick={e => { e.stopPropagation(); window.open(p.datasheetUrl, '_blank', 'noopener'); }}
                title="Open datasheet"
                style={{
                  flexShrink: 0, width: 26, height: 26, borderRadius: 6,
                  background: '#16213e', border: '1px solid #2a2a4a',
                  color: '#60a5fa', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >ℹ</button>
            )}
          </div>
        );
      })}

      {/* Custom panel row */}
      <div
        onClick={() => onChange(-1)}
        style={{
          background: selected === -1 ? '#1a2a40' : '#0f172a',
          border: `1.5px solid ${selected === -1 ? '#4ade80' : '#2a2a4a'}`,
          borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <div style={{
          width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
          background: selected === -1 ? '#4ade80' : 'transparent',
          border: `2px solid ${selected === -1 ? '#4ade80' : '#4a5568'}`,
        }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: selected === -1 ? '#4ade80' : '#9ca3af' }}>
            🛠 Pannello personalizzato
          </div>
          <div style={{ fontSize: '0.68rem', color: '#666' }}>Inserisci le specifiche manualmente</div>
        </div>
      </div>
    </div>
  );
}

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

function Section({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888' }}>{title}</div>
      {children}
    </div>
  );
}
function Divider() { return <div style={{ height: 1, background: '#2a2a4a' }} />; }
function Empty({ msg }) {
  return <div style={{ fontSize: '0.78rem', color: '#666' }}>{msg}</div>;
}
const inputStyle = {
  background: '#0f172a', color: '#e0e0e0',
  border: '1px solid #2a2a4a', borderRadius: 6,
  padding: '7px 10px', fontSize: '0.85rem',
};
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
