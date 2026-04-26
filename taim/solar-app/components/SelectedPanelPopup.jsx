'use client';

import { store, useStore } from '@/lib/store';

// Floating popup shown whenever exactly one panel is selected. Lets the
// installer rotate or delete that panel without having to scroll the right
// sidebar. Drag-to-move happens directly on the panel mesh in the 3D view.
export default function SelectedPanelPopup() {
  const selectedKeys = useStore(s => s.selectedPanelKeys);
  if (selectedKeys.length !== 1) return null;

  const dispatch = (n, detail) => window.dispatchEvent(new CustomEvent(n, detail !== undefined ? { detail } : undefined));
  const rotate = (delta) => dispatch('panel:rotate', { delta });

  return (
    <div
      style={{
        position: 'absolute',
        top: 70,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 45,
        background: 'rgba(13,27,42,0.96)',
        border: '1px solid #f5a623',
        borderRadius: 14,
        boxShadow: '0 14px 32px rgba(0,0,0,0.55)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 320,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: '#f5a623', fontWeight: 800, fontSize: '0.85rem', letterSpacing: '0.04em' }}>
          ☀ Selected panel
        </span>
        <button
          onClick={() => store.set({ selectedPanelKeys: [], hint: 'Panel deselected' })}
          title="Deselect"
          style={closeBtn}
        >✕</button>
      </div>
      <div style={{ fontSize: '0.7rem', color: '#9ca3af', lineHeight: 1.4 }}>
        Drag the panel on the roof to move it · rotate with the buttons below.
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <RotBtn onClick={() => rotate(-15)} title="Rotate −15°">↺ −15°</RotBtn>
        <RotBtn onClick={() => rotate(-5)}  title="Rotate −5°">↺ −5°</RotBtn>
        <RotBtn onClick={() => rotate(+5)}  title="Rotate +5°">↻ +5°</RotBtn>
        <RotBtn onClick={() => rotate(+15)} title="Rotate +15°">↻ +15°</RotBtn>
      </div>
      <button
        onClick={() => dispatch('panel:deleteSelected')}
        style={{
          background: '#3b0d0d',
          border: '1px solid #ff7070',
          color: '#fecaca',
          fontWeight: 700,
          padding: '8px 10px',
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: '0.8rem',
        }}
        title="Delete this panel"
      >🗑 Delete panel</button>
    </div>
  );
}

function RotBtn({ onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        flex: 1,
        background: '#16213e',
        border: '1px solid #2a2a4a',
        color: '#f5a623',
        fontWeight: 700,
        padding: '8px 0',
        borderRadius: 8,
        cursor: 'pointer',
        fontSize: '0.8rem',
      }}
    >{children}</button>
  );
}

const closeBtn = {
  background: 'transparent',
  border: 'none',
  color: '#9ca3af',
  fontSize: '0.95rem',
  cursor: 'pointer',
  fontWeight: 800,
  padding: '0 4px',
};
