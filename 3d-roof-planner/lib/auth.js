// Installer auth — single-page localStorage session.
//
// We're not running a backend yet, so "login" just records the installer's
// name + email + company in localStorage and tags every saved project with
// the installer's id. The dashboard then groups projects by client under
// that installer's namespace, which is what the central-website workflow
// needs ("each installer sees their own clients, sorted into cards").
//
// Demo accounts are hard-coded so there's a credible login screen for
// demos without needing a registration flow. Anything else is accepted
// via "Continue as guest installer" so the workshop never gets stuck on
// auth — the data still ends up scoped to that installer's email.

const KEY = 'tectum.installer.v1';

const DEMO_ACCOUNTS = [
  { email: 'demo@tectum.io',     password: 'tectum',  name: 'Demo Installer',   company: 'Tectum Solar Berlin' },
  { email: 'anna@solarberlin.de', password: 'solar',  name: 'Anna Schmidt',     company: 'SolarBerlin GmbH'    },
  { email: 'paul@dachwerk.de',   password: 'dach',    name: 'Paul Krüger',     company: 'Dachwerk Brandenburg' },
];

export function listDemoAccounts() {
  return DEMO_ACCOUNTS.map(({ password, ...rest }) => rest);
}

export function getInstaller() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setInstaller(installer) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, JSON.stringify(installer)); } catch {}
}

export function signOut() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(KEY); } catch {}
}

// Returns { installer } on success, { error } on failure.
export function signIn({ email, password }) {
  const e = (email || '').trim().toLowerCase();
  if (!e) return { error: 'Enter your email address.' };
  const match = DEMO_ACCOUNTS.find(a => a.email.toLowerCase() === e);
  if (match) {
    if ((password || '') !== match.password) return { error: 'Wrong password for this demo account.' };
    const installer = { id: match.email, email: match.email, name: match.name, company: match.company };
    setInstaller(installer);
    return { installer };
  }
  // Unknown email → accept as guest, so the demo flow is never blocked.
  const installer = {
    id: e,
    email: e,
    name: e.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    company: 'Independent installer',
    guest: true,
  };
  setInstaller(installer);
  return { installer };
}
