'use client';
import { useEffect, useRef, useState } from 'react';
import { store, useStore } from '@/lib/store';
import { listProjects, getProject, saveProject, deleteProject, blobFromObjectUrl, newProjectId, rehydrateProjectState } from '@/lib/projects';
import { getInstaller, signIn, signOut, listDemoAccounts } from '@/lib/auth';
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
import SolarTool from './SolarTool';

export default function SolarPlanner() {
  const selectedModel = useStore(s => s.selectedModel);
  // Hydrate the installer once on mount; null = not signed in yet, in
  // which case we render the login screen instead of the planner.
  const [installer, setInstallerState] = useState(undefined); // undefined = loading
  useEffect(() => { setInstallerState(getInstaller()); }, []);
  const onSignIn = (i) => setInstallerState(i);
  const onSignOut = () => {
    signOut();
    setInstallerState(null);
    // Drop any open project so the next installer doesn't inherit it.
    store.set({
      selectedModel: null, loaded: false, currentProjectId: null,
      roofs: [], templates: [], drafts: [], intake: null,
      activeRoofId: null, activeTemplateId: null, activeDraftId: null,
      draftEditing: false,
    });
  };

  if (installer === undefined) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#0d1b2a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#9ca3af',
      }}>Starting Tectum…</div>
    );
  }
  if (!installer) return <LoginScreen onSignIn={onSignIn} />;

  if (!selectedModel) return <DashboardScreen installer={installer} onSignOut={onSignOut} />;
  return (
    <>
      <PlannerView />
      <ProjectAutoSave installer={installer} />
    </>
  );
}

// ── Login ──────────────────────────────────────────────────────────────
function LoginScreen({ onSignIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const demos = listDemoAccounts();

  const submit = (e) => {
    e?.preventDefault?.();
    const result = signIn({ email, password });
    if (result.error) { setError(result.error); return; }
    setError('');
    onSignIn(result.installer);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'linear-gradient(140deg,#0d1b2a 0%,#11243d 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <form onSubmit={submit} style={{
        width: 'min(420px, 100%)', background: '#16213e',
        border: '1px solid #2a2a4a', borderRadius: 16, padding: 28,
        display: 'flex', flexDirection: 'column', gap: 14,
        boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          <h1 style={{ fontSize: '1.8rem', color: '#f5a623', margin: 0 }}>☀️ Tectum</h1>
          <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginTop: 4 }}>
            Installer portal · sign in to your client dashboard
          </p>
        </div>
        <label style={authLabel}>Email
          <input
            type="email" value={email} autoFocus
            onChange={e => setEmail(e.target.value)}
            placeholder="you@yourcompany.com"
            style={authInput}
          />
        </label>
        <label style={authLabel}>Password
          <input
            type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="optional for guest access"
            style={authInput}
          />
        </label>
        {error && <div style={{ color: '#f87171', fontSize: '0.8rem' }}>{error}</div>}
        <button type="submit" style={{
          background: '#f5a623', color: '#0d1b2a', border: 'none',
          padding: '12px 18px', borderRadius: 10, fontWeight: 800,
          fontSize: '0.95rem', cursor: 'pointer',
        }}>Sign in</button>
        <div style={{ borderTop: '1px solid #2a2a4a', paddingTop: 12, marginTop: 4 }}>
          <div style={{ fontSize: '0.7rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Demo accounts
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {demos.map(d => (
              <button
                key={d.email} type="button"
                onClick={() => { setEmail(d.email); setPassword(d.email.split('@')[0].split('.')[0] === 'demo' ? 'tectum' : (d.email.startsWith('anna') ? 'solar' : 'dach')); }}
                style={{
                  background: '#0f172a', border: '1px solid #2a2a4a',
                  color: '#cbd5e1', padding: '8px 10px', borderRadius: 8,
                  textAlign: 'left', cursor: 'pointer', fontSize: '0.78rem',
                }}
                title="Click to fill the demo credentials"
              >
                <b style={{ color: '#e0e0e0' }}>{d.name}</b> · <span style={{ color: '#9ca3af' }}>{d.email}</span>
                <div style={{ fontSize: '0.7rem', color: '#666' }}>{d.company}</div>
              </button>
            ))}
          </div>
          <div style={{ fontSize: '0.68rem', color: '#666', marginTop: 8 }}>
            New here? Enter any email to continue as a guest installer — your projects stay scoped to that email on this machine.
          </div>
        </div>
      </form>
    </div>
  );
}

const authLabel = { display: 'flex', flexDirection: 'column', gap: 4, color: '#9ca3af', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 1 };
const authInput = { background: '#0f172a', border: '1px solid #2a2a4a', borderRadius: 8, padding: '10px 12px', color: '#e0e0e0', fontSize: '0.9rem' };

// Pull intake info passed in from the Tectum sales funnel (src/) via
// URL params (?client=&address=&postal=&...) only. We deliberately do
// NOT fall back to sessionStorage here, otherwise the new-project wizard
// would jump straight to step 2 forever after the first funnel handoff.
// Returns null when the user opened the planner directly (no params).
function readIntake() {
  if (typeof window === 'undefined') return null;
  if (window.__tectumIntake) return window.__tectumIntake;
  const sp = new URLSearchParams(window.location.search);
  const has = ['client', 'address', 'postal', 'email'].some(k => sp.has(k) && sp.get(k));
  if (!has) return null;
  const get = (k) => sp.get(k) || '';
  const intake = {
    name: get('client'),
    email: get('email'),
    address: get('address'),
    postalCode: get('postal'),
    monthlyBill: Number(get('bill')) || undefined,
    roofType: get('roofType') || undefined,
    orientation: get('orientation') || undefined,
  };
  return intake;
}

// Wipe the funnel handoff URL so subsequent visits to the dashboard don't
// keep auto-routing into the import wizard. Called once the wizard has
// consumed the params (either by importing a model or by cancelling).
function clearIntakeFromUrl() {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    ['client', 'email', 'address', 'postal', 'bill', 'roofType', 'orientation'].forEach(k => url.searchParams.delete(k));
    window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
  } catch {}
  try { window.__tectumIntake = null; } catch {}
}

// ── New-project wizard ────────────────────────────────────────────────
//
// Two screens: (1) collect client / site info — same fields as the
// Tectum sales-funnel intake form, so the installer fills the same
// dossier when they're starting a project from scratch on the dashboard;
// (2) drag/drop the .glb of the building. After step 2 finishes we mint
// a fresh `currentProjectId` and flip into the planner; the auto-saver
// persists everything from there.
function ImportScreen({ onCancel } = {}) {
  // If the planner was opened from the sales funnel (URL params or
  // sessionStorage), pre-fill the form with that intake so the installer
  // doesn't retype it. They can still edit any field before continuing.
  const seeded = readIntake();
  const [step, setStep] = useState(seeded ? 2 : 1);
  const [intake, setIntake] = useState(seeded || {
    name: '', email: '', address: '', postalCode: '',
    monthlyBill: '', roofType: '', orientation: '',
  });
  const [projectName, setProjectName] = useState(
    seeded?.name ? `${seeded.name}${seeded.address ? ' – ' + seeded.address : ''}` : ''
  );

  const setField = (k) => (e) => setIntake(prev => ({ ...prev, [k]: e.target.value }));

  const goToUpload = (e) => {
    e?.preventDefault?.();
    if (!intake.name?.trim()) return;
    // Stash intake into the live store so TemplatesPanel and the auto-saver
    // see the client info immediately. We also drop any leftover funnel
    // URL params so a refresh on step 2 doesn't relaunch the wizard.
    const cleaned = { ...intake, monthlyBill: intake.monthlyBill ? Number(intake.monthlyBill) : undefined };
    store.set({ intake: cleaned });
    clearIntakeFromUrl();
    if (!projectName.trim()) {
      setProjectName(`${cleaned.name}${cleaned.address ? ' – ' + cleaned.address : ''}`);
    }
    setStep(2);
  };

  if (step === 1) {
    return (
      <div style={wizardWrap}>
        <WizardHeader step={1} total={2} title="New project · client details" onCancel={onCancel} />
        <form onSubmit={goToUpload} style={wizardCard}>
          <Row>
            <Field label="Client name *">
              <input required value={intake.name} onChange={setField('name')} placeholder="e.g. Familie Schmidt" style={authInput} />
            </Field>
            <Field label="Email">
              <input type="email" value={intake.email} onChange={setField('email')} placeholder="client@email.com" style={authInput} />
            </Field>
          </Row>
          <Field label="Site address">
            <input value={intake.address} onChange={setField('address')} placeholder="Street, number, city" style={authInput} />
          </Field>
          <Row>
            <Field label="Postal code">
              <input value={intake.postalCode} onChange={setField('postalCode')} placeholder="10115" style={authInput} />
            </Field>
            <Field label="Monthly electricity bill (€)">
              <input type="number" min="0" value={intake.monthlyBill} onChange={setField('monthlyBill')} placeholder="150" style={authInput} />
            </Field>
          </Row>
          <Row>
            <Field label="Roof type">
              <select value={intake.roofType || ''} onChange={setField('roofType')} style={authInput}>
                <option value="">— select —</option>
                <option value="gable">Gable (pitched)</option>
                <option value="hip">Hip</option>
                <option value="flat">Flat</option>
                <option value="shed">Shed / mono-pitch</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Main orientation">
              <select value={intake.orientation || ''} onChange={setField('orientation')} style={authInput}>
                <option value="">— select —</option>
                <option value="S">South</option>
                <option value="SE">South-East</option>
                <option value="SW">South-West</option>
                <option value="E">East</option>
                <option value="W">West</option>
                <option value="N">North</option>
              </select>
            </Field>
          </Row>
          <Field label="Project name (auto from client + address)">
            <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Müller residence – Berlin" style={authInput} />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            {onCancel ? (
              <button type="button" onClick={onCancel} style={wizardBtnGhost}>Cancel</button>
            ) : <span />}
            <button
              type="submit"
              disabled={!intake.name?.trim()}
              style={{ ...wizardBtnPrimary, opacity: intake.name?.trim() ? 1 : 0.4, cursor: intake.name?.trim() ? 'pointer' : 'not-allowed' }}
            >Next · Add 3D model →</button>
          </div>
        </form>
      </div>
    );
  }

  // ── Step 2 · 3D model upload
  return (
    <ImportFileStep
      intake={intake}
      projectName={projectName}
      setProjectName={setProjectName}
      onBack={seeded ? undefined : () => setStep(1)}
      onCancel={onCancel}
    />
  );
}

function ImportFileStep({ intake, projectName, setProjectName, onBack, onCancel }) {
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    const name = file.name || 'model.glb';
    if (!/\.glb$/i.test(name) && file.type !== 'model/gltf-binary') {
      setError('Please select a .glb file (binary glTF).');
      return;
    }
    setError('');
    const url = URL.createObjectURL(file);
    const baseName = name.replace(/\.glb$/i, '');
    const finalProject = (projectName || '').trim() || (intake?.name ? `${intake.name}${intake?.address ? ' – ' + intake.address : ''}` : baseName);
    store.set({
      selectedModel: { name: baseName, file: url, icon: '🏠', uploaded: true, fileName: name },
      loaded: false,
      loadProgress: 0,
      // Stash project name so the Templates tab can auto-name the first
      // saved template after the client / project rather than "Template 1".
      pendingProjectName: finalProject,
      // Mint a fresh project record id so the auto-saver starts persisting
      // this customer's workspace to IndexedDB from the very first edit.
      currentProjectId: newProjectId(),
      intake,
      // Fresh project — clear any previously loaded templates / drafts /
      // roofs from the live store. (When resuming from the dashboard we
      // route through `_resume` instead, see DashboardScreen.)
      roofs: [], templates: [], drafts: [],
      activeRoofId: null, activeTemplateId: null, activeDraftId: null,
      _resume: null,
    });
    clearIntakeFromUrl();
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  };

  return (
    <div style={wizardWrap}>
      <WizardHeader step={2} total={2} title={`New project · 3D model${intake?.name ? ' for ' + intake.name : ''}`} onCancel={onCancel} />
      <div style={{ ...wizardCard, gap: 18 }}>
        {intake && (
          <div style={{ background: '#0f172a', border: '1px solid #2a2a4a', borderRadius: 10, padding: '10px 14px', fontSize: '0.78rem', color: '#cbd5e1' }}>
            <b style={{ color: '#f5a623' }}>{intake.name}</b>
            {intake.email   && <> · {intake.email}</>}
            {intake.address && <> · 📍 {intake.address}</>}
            {intake.monthlyBill && <> · €{intake.monthlyBill}/mo</>}
          </div>
        )}

        <Field label="Project name">
          <input value={projectName} onChange={e => setProjectName(e.target.value)} style={authInput} />
        </Field>

        <div
          onClick={() => inputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
          onDragOver={(e) => { e.preventDefault(); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          style={{
            minHeight: 200, borderRadius: 14,
            border: `2px dashed ${drag ? '#f5a623' : '#2a2a4a'}`,
            background: drag ? 'rgba(245,166,35,0.08)' : '#0f172a',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 8, cursor: 'pointer', color: '#e0e0e0', transition: 'all 0.15s ease',
          }}
        >
          <div style={{ fontSize: '2.4rem' }}>📦</div>
          <div style={{ fontWeight: 600 }}>Drop a .glb file here, or click to browse</div>
          <div style={{ fontSize: '0.72rem', color: '#888' }}>Binary glTF · stays on your machine, never uploaded</div>
          <input
            ref={inputRef}
            type="file"
            accept=".glb,model/gltf-binary"
            style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>

        {error && <div style={{ color: '#f87171', fontSize: '0.8rem' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          {onBack ? (
            <button type="button" onClick={onBack} style={wizardBtnGhost}>← Back</button>
          ) : (onCancel ? <button type="button" onClick={onCancel} style={wizardBtnGhost}>Cancel</button> : <span />)}
          <div style={{ color: '#666', fontSize: '0.72rem', alignSelf: 'center' }}>
            Tip: export from CAD or drone photogrammetry as GLB.
          </div>
        </div>
      </div>
    </div>
  );
}

const wizardWrap = {
  width: '100%', minHeight: 'calc(100vh - 70px)',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  padding: '32px 24px 64px', gap: 18,
  background: 'linear-gradient(140deg,#0d1b2a 0%,#11243d 100%)',
};
const wizardCard = {
  width: 'min(620px, 100%)', background: '#16213e',
  border: '1px solid #2a2a4a', borderRadius: 16, padding: 24,
  display: 'flex', flexDirection: 'column', gap: 14,
  boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
};
const wizardBtnPrimary = {
  background: '#f5a623', color: '#0d1b2a', border: 'none',
  padding: '10px 18px', borderRadius: 10, fontWeight: 800,
  fontSize: '0.9rem', cursor: 'pointer',
};
const wizardBtnGhost = {
  background: 'transparent', color: '#cbd5e1',
  border: '1px solid #38506d', padding: '8px 14px',
  borderRadius: 10, fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600,
};

function WizardHeader({ step, total, title, onCancel }) {
  return (
    <div style={{ width: 'min(620px, 100%)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ color: '#f5a623', fontSize: '1.4rem', margin: 0 }}>☀️ {title}</h1>
        {onCancel && <button onClick={onCancel} style={wizardBtnGhost}>Cancel</button>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 999,
            background: i < step ? '#f5a623' : '#2a2a4a',
          }} />
        ))}
      </div>
      <div style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Step {step} of {total}</div>
    </div>
  );
}

function Row({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>;
}
function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ color: '#9ca3af', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</span>
      {children}
    </label>
  );
}


// ── Dashboard ──────────────────────────────────────────────────────────
//
// Shown whenever no project is open in the planner. Lists every project
// previously imported on this machine as a card (with the 45° thumbnail,
// template count, draft count and intake summary), and exposes a
// "+ New Project" button that flips to the ImportScreen above.
//
// Cards are sorted by `savedAt` (newest first) and clicking one resumes
// the project: the .glb blob is re-materialised into an object URL and
// `_resume` is set so Scene.jsx hydrates roofs / templates / drafts after
// the GLB has loaded (instead of resetting them to empty).
function DashboardScreen({ installer, onSignOut }) {
  const [projects, setProjects] = useState(null); // null = loading
  const [importing, setImporting] = useState(false);
  // Skip the dashboard entirely when the user just arrived from the
  // Tectum sales-funnel intake page — they have a fresh client and
  // expect to land on "Import a model", not the project gallery.
  const intakeFromUrl = (() => {
    if (typeof window === 'undefined') return false;
    const sp = new URLSearchParams(window.location.search);
    return ['client', 'address', 'postal', 'email'].some(k => sp.has(k));
  })();
  useEffect(() => {
    if (intakeFromUrl) { setImporting(true); return; }
    listProjects(installer?.id).then(setProjects);
  }, [intakeFromUrl, installer?.id]);

  const cancelImport = () => {
    setImporting(false);
    clearIntakeFromUrl();
    listProjects(installer?.id).then(setProjects);
  };

  if (importing) {
    return (
      <div style={{
        position: 'fixed', inset: 0, overflow: 'auto',
        background: 'linear-gradient(140deg,#0d1b2a 0%,#11243d 100%)',
      }}>
        <InstallerHeader installer={installer} onSignOut={onSignOut} subtitle="Adding a new project" />
        <ImportScreen onCancel={cancelImport} />
      </div>
    );
  }

  if (projects === null) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#0d1b2a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#9ca3af',
      }}>Loading projects…</div>
    );
  }

  const refresh = () => listProjects(installer?.id).then(setProjects);

  return (
    <div style={{
      position: 'fixed', inset: 0, overflow: 'auto',
      background: 'linear-gradient(140deg,#0d1b2a 0%,#11243d 100%)',
      paddingBottom: 48,
    }}>
      <InstallerHeader
        installer={installer}
        onSignOut={onSignOut}
        subtitle={projects.length === 0
          ? 'No projects yet — start your first one'
          : `${projects.length} project${projects.length === 1 ? '' : 's'} on this dashboard`}
      />

      <div style={{ padding: '24px 40px' }}>
        <div style={{
          display: 'grid', gap: 20,
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        }}>
          {/* The dotted "+ Add Project" tile is always the first card so
              it's the obvious next action whether the dashboard is empty
              or already full of work. */}
          <AddProjectCard onClick={() => setImporting(true)} />
          {projects.map(p => (
            <ProjectCard key={p.id} project={p} onChange={refresh} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Dotted-outline tile with a centered + sign. Hovering swaps to the
// brand orange so it reads as the primary call-to-action.
function AddProjectCard({ onClick }) {
  const [hover, setHover] = useState(false);
  const accent = hover ? '#f5a623' : '#38506d';
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: 'pointer',
        borderRadius: 14,
        border: `2px dashed ${accent}`,
        background: hover ? 'rgba(245,166,35,0.06)' : 'rgba(22,33,62,0.5)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 10, padding: '40px 16px', minHeight: 280,
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{
        width: 56, height: 56, borderRadius: 999,
        background: hover ? '#f5a623' : '#1e2a44',
        color: hover ? '#0d1b2a' : '#9ca3af',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.8rem', fontWeight: 800, transition: 'all 0.15s ease',
      }}>＋</div>
      <div style={{ color: hover ? '#f5a623' : '#cbd5e1', fontWeight: 700, fontSize: '0.95rem' }}>
        Add new project
      </div>
      <div style={{ color: '#9ca3af', fontSize: '0.72rem', textAlign: 'center', maxWidth: 220 }}>
        Enter the client&apos;s details, then upload the building&apos;s 3D model.
      </div>
    </div>
  );
}

// Top bar shared between the dashboard, the import screen and the planner.
// Shows installer name + company on the left, a contextual subtitle in the
// middle, and any caller-supplied controls + a Sign-out button on the right.
function InstallerHeader({ installer, onSignOut, subtitle, right }) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 40,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 16, padding: '14px 24px', flexWrap: 'wrap',
      background: 'rgba(10,18,34,0.92)', borderBottom: '1px solid #2a2a4a',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 999,
          background: '#f5a623', color: '#0d1b2a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800,
        }}>{(installer?.name || '?').slice(0, 1).toUpperCase()}</div>
        <div>
          <div style={{ color: '#e0e0e0', fontWeight: 700, fontSize: '0.95rem' }}>
            {installer?.name}{installer?.guest && <span style={{ color: '#888', fontWeight: 400 }}> · guest</span>}
          </div>
          <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>
            {installer?.company} · {installer?.email}
          </div>
        </div>
      </div>
      {subtitle && (
        <div style={{ color: '#cbd5e1', fontSize: '0.82rem', flex: 1, textAlign: 'center', minWidth: 200 }}>
          {subtitle}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {right}
        <button
          onClick={onSignOut}
          style={{
            background: 'transparent', border: '1px solid #38506d',
            color: '#cbd5e1', padding: '8px 14px', borderRadius: 8,
            fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600,
          }}
          title="Sign out of the installer portal"
        >Sign out</button>
      </div>
    </div>
  );
}

function ProjectCard({ project, onChange }) {
  const tplCount    = project.templates?.length ?? 0;
  const draftCount  = project.drafts?.length ?? 0;
  const intake      = project.intake;
  const open = async () => {
    const full = await getProject(project.id);
    if (!full) return;
    let url = null;
    if (full.modelBlob) {
      url = URL.createObjectURL(full.modelBlob);
    }
    if (!url) {
      alert('Saved 3D model could not be restored. Please re-import the .glb file.');
      return;
    }
    // Stash the saved roofs / templates / drafts under `_resume` so that
    // Scene.jsx applies them AFTER the GLB has finished loading (otherwise
    // the load-complete handler would wipe them). Three.js Vector3 /
    // Quaternion instances are rebuilt here — IDB serialisation strips
    // the prototypes, so panels would otherwise blow up on `.toArray()`.
    const resumed = rehydrateProjectState({
      roofs: full.roofs,
      templates: full.templates,
      drafts: full.drafts,
    });
    store.set({
      selectedModel: { name: full.name || 'Project', file: url, icon: '🏠', uploaded: true, fileName: full.modelFileName },
      loaded: false,
      loadProgress: 0,
      currentProjectId: project.id,
      intake: full.intake ?? null,
      pendingProjectName: null,
      _resume: resumed,
    });
  };
  const remove = async (e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete project "${project.name}"? This removes the saved 3D model, templates and drafts. This cannot be undone.`)) return;
    await deleteProject(project.id);
    onChange?.();
  };
  return (
    <div
      onClick={open}
      style={{
        background: '#16213e', border: '1px solid #2a2a4a', borderRadius: 14,
        overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.15s, border-color 0.15s',
        display: 'flex', flexDirection: 'column',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#f5a623'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a4a'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{
        width: '100%', aspectRatio: '4 / 3',
        background: project.thumbnail ? `#0d1b2a url(${project.thumbnail}) center/cover no-repeat` : '#0d1b2a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#3a4a66', fontSize: '2.4rem',
      }}>
        {!project.thumbnail && '🏠'}
      </div>
      <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ fontWeight: 700, color: '#e0e0e0', fontSize: '0.95rem', lineHeight: 1.2 }}>
            {project.name || 'Untitled'}
          </div>
          <button
            onClick={remove}
            title="Delete project"
            style={{
              background: 'rgba(255,112,112,0.10)',
              border: '1px solid rgba(255,112,112,0.25)',
              color: '#ff8080',
              cursor: 'pointer',
              padding: 0,
              width: 32, height: 32,
              borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,112,112,0.22)';
              e.currentTarget.style.borderColor = 'rgba(255,112,112,0.55)';
              e.currentTarget.style.color = '#ffb0b0';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,112,112,0.10)';
              e.currentTarget.style.borderColor = 'rgba(255,112,112,0.25)';
              e.currentTarget.style.color = '#ff8080';
            }}
          >
            <svg
              width="16" height="16" viewBox="0 0 24 24"
              fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 7h16" />
              <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
              <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
        </div>
        {intake?.email && (
          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>✉ {intake.email}</div>
        )}
        {intake?.address && (
          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>📍 {intake.address}</div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: '0.72rem', color: '#cbd5e1', flexWrap: 'wrap' }}>
          <span style={{ background: '#1e2a44', padding: '3px 8px', borderRadius: 999 }}>📁 {tplCount} template{tplCount === 1 ? '' : 's'}</span>
          <span style={{ background: '#1e2a44', padding: '3px 8px', borderRadius: 999 }}>📄 {draftCount} draft{draftCount === 1 ? '' : 's'}</span>
        </div>
        {/* Per-template draft breakdown — answers "how many drafts under
            each template" at a glance, capped at 3 lines + "and N more". */}
        {tplCount > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {project.templates.slice(0, 3).map(t => {
              const dn = (project.drafts || []).filter(d => d.templateId === t.id).length;
              return (
                <div key={t.id} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 6,
                  fontSize: '0.7rem', color: '#cbd5e1',
                  padding: '2px 0',
                }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📁 {t.name}</span>
                  <span style={{ color: '#9ca3af' }}>{dn} draft{dn === 1 ? '' : 's'}</span>
                </div>
              );
            })}
            {tplCount > 3 && (
              <div style={{ fontSize: '0.68rem', color: '#666' }}>and {tplCount - 3} more…</div>
            )}
          </div>
        )}
        <div style={{ color: '#666', fontSize: '0.68rem', marginTop: 6 }}>
          {project.savedAt ? `Last saved ${timeAgoShort(project.savedAt)}` : ''}
        </div>
      </div>
    </div>
  );
}

function timeAgoShort(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
}

// ── Auto-save ──────────────────────────────────────────────────────────
//
// Mounted alongside PlannerView. Persists the current project's roofs /
// templates / drafts / intake to IndexedDB ~600 ms after any change, so
// closing the tab or hitting Back never loses progress. The .glb blob is
// only fetched + stored once per project (the first save), since blob
// URLs are cheap to convert but we don't want to repeat it on every edit.
function ProjectAutoSave({ installer }) {
  const projectId   = useStore(s => s.currentProjectId);
  const selected    = useStore(s => s.selectedModel);
  const intake      = useStore(s => s.intake);
  const roofs       = useStore(s => s.roofs);
  const templates   = useStore(s => s.templates);
  const drafts      = useStore(s => s.drafts);
  const loaded      = useStore(s => s.loaded);
  const pendingName = useStore(s => s.pendingProjectName);
  const installerId = installer?.id || null;
  const blobSavedRef = useRef(new Set()); // project ids whose Blob has been written

  // Persist the .glb blob exactly once per project (heavy write).
  useEffect(() => {
    if (!projectId || !selected?.file || !loaded) return;
    if (blobSavedRef.current.has(projectId)) return;
    let cancelled = false;
    (async () => {
      const blob = await blobFromObjectUrl(selected.file);
      if (cancelled) return;
      const projectName = pendingName || intake?.name
        ? (intake?.name ? `${intake.name}${intake?.address ? ' – ' + intake.address : ''}` : pendingName)
        : (selected?.name || 'Untitled project');
      await saveProject(projectId, {
        name: projectName,
        intake,
        installerId,
        modelBlob: blob,
        modelFileName: selected.fileName || (selected.name ? selected.name + '.glb' : null),
      });
      blobSavedRef.current.add(projectId);
    })();
    return () => { cancelled = true; };
  }, [projectId, selected?.file, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced save of the lightweight workspace state (roofs / templates /
  // drafts / intake / name) on every change. Skipped until the GLB blob
  // write above has happened, otherwise we'd write an orphan record.
  useEffect(() => {
    if (!projectId || !loaded) return;
    if (!blobSavedRef.current.has(projectId)) return;
    const t = setTimeout(() => {
      const projectName = (intake?.name
        ? `${intake.name}${intake?.address ? ' – ' + intake.address : ''}`
        : pendingName || selected?.name || 'Untitled project');
      saveProject(projectId, {
        name: projectName,
        intake,
        installerId,
        roofs,
        templates,
        drafts,
      }).catch(err => console.warn('[autosave] failed:', err));
    }, 600);
    return () => clearTimeout(t);
  }, [projectId, loaded, intake, roofs, templates, drafts, pendingName, selected?.name, installerId]);

  // Capture a fresh thumbnail whenever the number of templates changes
  // (i.e. the user just saved one), and when the user explicitly heads
  // back to the dashboard. Re-uses the same code path via a custom event.
  const tplCount = templates.length;
  const lastTplCountRef = useRef(tplCount);
  useEffect(() => {
    if (!projectId || !loaded) return;
    if (tplCount === lastTplCountRef.current) return;
    lastTplCountRef.current = tplCount;
    captureSnapshotAndSave(projectId);
  }, [projectId, loaded, tplCount]);

  return null;
}

// Fire a `project:snapshot` event into Scene.jsx; it renders the model at
// 45° and hands back a JPEG data URL, which we then write to IndexedDB
// under the given project id.
export function captureSnapshotAndSave(projectId) {
  if (!projectId || typeof window === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const done = (dataUrl) => {
      if (!dataUrl) return resolve();
      saveProject(projectId, { thumbnail: dataUrl })
        .catch(err => console.warn('[snapshot] save failed:', err))
        .finally(resolve);
    };
    window.dispatchEvent(new CustomEvent('project:snapshot', { detail: { done } }));
  });
}


function PlannerView() {
  const loaded       = useStore(s => s.loaded);
  const progress     = useStore(s => s.loadProgress);
  const tab          = useStore(s => s.activeTab);
  const draftEditing = useStore(s => s.draftEditing);
  // When a multi-select is active the bottom controls dock is replaced by
  // the SelectionActionBar so we never stack two floating panels on top of
  // each other in the same screen region.
  const selCount     = useStore(s => s.selectedRoofIds.length);
  // Roof-detection action surface (mode buttons, drag overlays, rotation pad,
  // multi-select bar) shows on the Roof Detection tab AND whenever a draft
  // is open inside the Templates tab — so panels and roof tweaks live
  // side-by-side under one workspace.
  const detectUI = tab === 'detect' || draftEditing;
  // The bottom controls dock (Mode + Smooth + slider) is roof-detection
  // specific. Keep it ONLY on the Roof Detection tab so it doesn't clutter
  // the Templates and Solar Irradiance views.
  const bottomDockUI = tab === 'detect';

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Scene />
      {!loaded && <LoadingOverlay progress={progress} />}
      {loaded && <>
        <TopBar />
        <TabsBar />
        {tab === 'detect'    && <Sidebar />}
        {tab === 'templates' && <TemplatesPanel />}
        {tab === 'solar'     && <SolarTool />}
        {bottomDockUI && (selCount > 0 ? <SelectionActionBar /> : <BottomControls />)}
        <DebugHUD />
        {detectUI && <CropOverlay />}
        {detectUI && <SelectOverlay />}
        {detectUI && <PolygonOverlay />}
        {detectUI && <PickOverlay />}
        {detectUI && <EraseOverlay />}
        {/* View controls (rotate/tilt/compass) are useful on every tab —
            collapsible so the installer can hide them when working in
            Templates or Solar Irradiance. */}
        <RotationPad />
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
  const roofs        = useStore(s => s.roofs.length);
  const draftEditing = useStore(s => s.draftEditing);
  const tab          = useStore(s => s.activeTab);
  const dispatch = (n) => window.dispatchEvent(new CustomEvent(n));
  // Measure our own width so TabsBar can centre itself between us and the
  // sidebar instead of overlapping. ResizeObserver fires whenever buttons
  // appear/disappear (Clear Workspace, model name length, etc.).
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => store.set({ topBarWidth: el.getBoundingClientRect().width });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { ro.disconnect(); store.set({ topBarWidth: 0 }); };
  }, []);
  return (
    <div ref={ref} style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8, zIndex: 30, alignItems: 'center' }}>
      <button
        onClick={async () => {
          // Persist the latest workspace state (roofs / templates / drafts)
          // and refresh the dashboard thumbnail BEFORE leaving, so the card
          // the installer lands on reflects the work they just did. Both
          // calls are best-effort — a failure won't trap them on this page.
          const pid = store.get().currentProjectId;
          if (pid) {
            const s = store.get();
            const projectName = (s.intake?.name
              ? `${s.intake.name}${s.intake?.address ? ' – ' + s.intake.address : ''}`
              : s.pendingProjectName || s.selectedModel?.name || 'Untitled project');
            try {
              await saveProject(pid, {
                name: projectName,
                intake: s.intake,
                installerId: s.intake?.installerId ?? undefined,
                roofs: s.roofs,
                templates: s.templates,
                drafts: s.drafts,
              });
            } catch {}
            try { await captureSnapshotAndSave(pid); } catch {}
          }
          store.set({
            selectedModel: null, loaded: false, roofs: [], activeRoofId: null,
            cropBounds: null, mode: 'orbit',
            currentProjectId: null,
            templates: [], drafts: [],
            activeTemplateId: null, activeDraftId: null,
            draftEditing: false,
          });
        }}
        style={btnStyle('secondary')}
      >← Projects</button>
      <div style={{
        background: 'rgba(22,33,62,0.85)', border: '1px solid #2a2a4a',
        borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem', color: '#aaa',
        maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }} title={model?.name}>{model?.name}</div>
      {/* 3D toggle stays universal — useful from every tab. The Tex toggle
          moved into the Roof Detection bottom dock since it's a detection-
          time visualisation aid. */}
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
      {/* Clear-workspace lives next to the 3D toggle so it's always reachable
          without crowding the centred tab strip. */}
      {tab === 'templates' && (
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
            background: '#b91c1c',
            color: '#fff',
            border: 'none', fontWeight: 700,
            opacity: (roofs || draftEditing) ? 1 : 0.4,
            cursor:  (roofs || draftEditing) ? 'pointer' : 'not-allowed',
          }}
          title="Clear the live workspace · saved templates and drafts are kept"
        >🧹 Clear Workspace</button>
      )}
    </div>
  );
}

// Top-centre tab strip — switches the right-hand sidebar between the three
// workspaces. Detection mode controls + drag overlays only render on the
// 'detect' tab (see PlannerView), so the other tabs feel like calm,
// dedicated screens.
function TabsBar() {
  const tab = useStore(s => s.activeTab);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const topBarWidth = useStore(s => s.topBarWidth);
  const templates = useStore(s => s.templates.length);
  const drafts    = useStore(s => s.drafts.length);
  const TABS = [
    { id: 'detect',    label: '🏠 Roof Detection' },
    { id: 'templates', label: `📁 Templates${templates ? ` (${templates}${drafts ? ` · ${drafts}d` : ''})` : ''}` },
    { id: 'solar',     label: '☀️ Solar Irradiance' },
  ];
  const dispatch = (n, detail) => window.dispatchEvent(new CustomEvent(n, detail !== undefined ? { detail } : undefined));

  const selectTab = (nextId) => {
    const s = store.get();
    if (s.activeTab === nextId) return;

    // Special handling: leaving a draft to go to Roof Detection should
    // (a) autosave the draft if it was already saved before, or prompt the
    //     user to save it if it's a fresh unsaved draft, then
    // (b) clear the workspace so the installer lands on a clean detect tab.
    if (nextId === 'detect' && s.draftEditing) {
      const totalPanels = s.roofs.reduce((sum, r) => sum + (r.panels?.length ?? 0), 0);
      if (s.activeDraftId) {
        // Re-save the existing draft under its current name (autosave).
        const draft = s.drafts.find(d => d.id === s.activeDraftId);
        if (draft) dispatch('draft:save', { name: draft.name });
      } else if (totalPanels > 0) {
        // Unsaved new draft with placed panels — ask the installer.
        const choice = window.confirm(
          'Save this draft before leaving?\n\nClick OK to save, or Cancel to discard the panel layout.'
        );
        if (choice) {
          const name = window.prompt('Draft name:', '') || '';
          if (!name.trim()) return; // empty name → abort the tab switch
          dispatch('draft:save', { name: name.trim() });
        }
        // If the user clicked Cancel, fall through and discard.
      }
      // Clear the in-scene roofs + panels and exit the draft editor.
      dispatch('workspace:clear');
    }

    store.set({ activeTab: nextId, activePanelDashboard: null });
  };

  // The TopBar sits at left:12 with its measured width; the sidebar (when
  // open) takes 320px on the right. Centre the tabs in the middle of the
  // remaining horizontal space so neither side ever overlaps it.
  const leftEdge  = 12 + topBarWidth + 12; // small breathing gap
  const rightEdge = sidebarOpen ? 320 : 0;
  const centerLeft = `calc(${leftEdge}px + (100% - ${leftEdge}px - ${rightEdge}px) / 2)`;

  return (
    <div style={{
      position: 'absolute', top: 12,
      left: centerLeft,
      transform: 'translateX(-50%)',
      display: 'flex', gap: 4, zIndex: 30,
      background: 'rgba(10,18,34,0.92)', border: '1px solid #38506d',
      borderRadius: 999, padding: 4, boxShadow: '0 10px 24px rgba(0,0,0,0.4)',
      transition: 'left 0.25s ease',
    }}>
      {TABS.map(t => {
        const active = t.id === tab;
        return (
          <button key={t.id}
            onClick={() => selectTab(t.id)}
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
  const texturesOn   = useStore(s => s.texturesOn);
  const sidebarOpen  = useStore(s => s.sidebarOpen);
  const [open, setOpen] = useState(true);

  // Centred along the bottom of whatever's visible: when the right-hand
  // sidebar is open, that's the viewport minus 320px; when it's hidden,
  // it's the full viewport.
  const wrapStyle = {
    position: 'fixed',
    bottom: 18,
    left: sidebarOpen ? 'calc((100% - 320px) / 2)' : '50%',
    transform: 'translateX(-50%)',
    zIndex: 45,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    transition: 'left 0.25s ease',
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
        borderRadius: 16, padding: '10px 14px', alignItems: 'center', flexWrap: 'nowrap',
        boxShadow: '0 14px 40px rgba(0,0,0,0.45)',
        maxWidth: sidebarOpen ? 'calc(100vw - 360px)' : 'calc(100vw - 40px)',
      }}>
        <ControlGroup label="Mode">
          <ModeCtl id="orbit"   current={mode} icon="👁">View</ModeCtl>
          <ModeCtl id="crop"    current={mode} icon="✂">Crop</ModeCtl>
          <ModeCtl id="select"  current={mode} icon="▣">Select</ModeCtl>
          <ModeCtl id="polygon" current={mode} icon="⬢">Polygon</ModeCtl>
          <ModeCtl id="pick"    current={mode} icon="🎯">Pick</ModeCtl>
          <ModeCtl id="erase"   current={mode} icon="🧽">Erase</ModeCtl>
        </ControlGroup>
        <button
          onClick={() => dispatch('mask:smooth')}
          disabled={!activeRoofId}
          style={{ ...btnStyle('ctl'), opacity: activeRoofId ? 1 : 0.4, cursor: activeRoofId ? 'pointer' : 'not-allowed' }}
          title="Sharpen and smooth ONLY the outline of the active roof's mask"
        >✨ Smooth Edges</button>
        <button
          onClick={() => store.set(s => ({ texturesOn: !s.texturesOn, hint: !s.texturesOn ? 'Textures on' : 'Textures off · plain shading reveals roof faces clearly' }))}
          style={{
            ...btnStyle('ctl'),
            background: texturesOn ? '#2a2a4a' : '#f5a623',
            color: texturesOn ? '#e0e0e0' : '#0d1b2a',
            fontWeight: 700,
          }}
          title="Show or hide building textures · plain shading helps see roof faces"
        >{texturesOn ? 'Tex On' : 'Tex Off'}</button>
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

function ModeCtl({ id, current, icon, children }) {
  const active = id === current;
  return (
    <button
      onClick={() => store.set({ mode: id, hint: modeHint(id) })}
      style={{
        ...btnStyle('ctl'),
        background: active ? '#4ade80' : '#2a2a4a',
        color: active ? '#0d1b2a' : '#e0e0e0',
        display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
      }}
    >
      {icon && <span aria-hidden="true" style={{ fontSize: '0.95em', lineHeight: 1 }}>{icon}</span>}
      {children}
    </button>
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
  const ids      = useStore(s => s.selectedRoofIds);
  const activeId = useStore(s => s.activeRoofId);
  const total    = useStore(s => s.roofs.length);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  if (!ids || ids.length === 0) return null;
  // The currently highlighted (active) roof is implicitly part of any
  // multi-selection — surface that in the count and apply it to actions so
  // the user doesn't have to remember to shift-click their own active roof.
  const effective = (activeId && !ids.includes(activeId)) ? [...ids, activeId] : ids;
  const ensureEffective = () => {
    if (effective.length !== ids.length) {
      store.set({ selectedRoofIds: effective });
    }
  };
  const dispatch = (name) => { ensureEffective(); window.dispatchEvent(new CustomEvent(name)); };
  const others = total - effective.length;
  const count  = effective.length;
  return (
    <div style={{
      position: 'fixed', bottom: 18,
      left: sidebarOpen ? 'calc((100% - 320px) / 2)' : '50%',
      transform: 'translateX(-50%)',
      zIndex: 46, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'nowrap',
      background: 'rgba(10,18,34,0.96)', border: '1px solid #a855f7',
      borderRadius: 16, padding: '10px 14px',
      boxShadow: '0 14px 40px rgba(0,0,0,0.45)',
      maxWidth: sidebarOpen ? 'calc(100vw - 360px)' : 'calc(100vw - 40px)',
      transition: 'left 0.25s ease',
    }}>
      <span style={{ color: '#d8b4fe', fontSize: '0.8rem', fontWeight: 700 }}>
        {count} selected
      </span>
      <button
        onClick={() => dispatch('roofs:merge')}
        disabled={count < 2}
        style={{
          background: count >= 2 ? '#a855f7' : '#2a2a4a',
          color: count >= 2 ? '#0d1b2a' : '#666',
          border: 'none', borderRadius: 999, padding: '6px 14px',
          fontSize: '0.78rem', fontWeight: 700,
          cursor: count >= 2 ? 'pointer' : 'not-allowed',
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
  // Hint toast removed — the chrome above already explains every tab/mode,
  // and the floating hint was overlapping the tab strip and bottom dock.
  return null;
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
