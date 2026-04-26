import { useState, useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { IntakePro } from './components/IntakePro';
import { signIn, signOut as authSignOut } from './taim/lib/auth';
import { getProject, rehydrateProjectState, newProjectId } from './taim/lib/projects';
import { store, useStore } from './taim/lib/store';
import SolarPlanner from './taim/components/SolarPlanner';
import { type IntakeData } from './lib/solar';

type Screen = 'login' | 'dashboard' | 'intake' | 'planner';

function usePlannerBackDetect(screen: Screen, onBack: () => void) {
  const selectedModel = useStore((s: any) => s.selectedModel);
  const wasInPlanner = useRef(false);

  useEffect(() => {
    if (screen === 'planner' && selectedModel) {
      wasInPlanner.current = true;
    }
    if (screen === 'planner' && !selectedModel && wasInPlanner.current) {
      wasInPlanner.current = false;
      onBack();
    }
  }, [screen, selectedModel, onBack]);
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [email, setEmail] = useState('');

  const handleLogin = useCallback((userEmail: string) => {
    signIn({ email: userEmail, password: '' });
    setEmail(userEmail);
    setScreen('dashboard');
    window.scrollTo(0, 0);
  }, []);

  const handleLogout = useCallback(() => {
    authSignOut();
    setEmail('');
    setScreen('login');
  }, []);

  const handleOpenProject = useCallback(async (projectId: string) => {
    const full = await getProject(projectId);
    if (!full) return;
    let url = null;
    if (full.modelBlob) {
      url = URL.createObjectURL(full.modelBlob);
    }
    if (!url) {
      alert('Saved 3D model could not be restored. Please re-import the .glb file.');
      return;
    }
    const resumed = rehydrateProjectState({
      roofs: full.roofs,
      templates: full.templates,
      drafts: full.drafts,
    });
    store.set({
      selectedModel: { name: full.name || 'Project', file: url, icon: '🏠', uploaded: true, fileName: full.modelFileName },
      loaded: false,
      loadProgress: 0,
      currentProjectId: projectId,
      intake: full.intake ?? null,
      pendingProjectName: null,
      _resume: resumed,
    });
    setScreen('planner');
  }, []);

  const handleNewProject = useCallback(() => {
    setScreen('intake');
  }, []);

  const handleIntakeComplete = useCallback((data: IntakeData, modelFile?: File) => {
    if (!modelFile) return;
    const url = URL.createObjectURL(modelFile);
    const projectName = `${data.name || 'Project'}${data.address ? ' – ' + data.address : ''}`;
    store.set({
      selectedModel: { name: modelFile.name.replace(/\.glb$/i, ''), file: url, icon: '🏠', uploaded: true, fileName: modelFile.name },
      loaded: false,
      loadProgress: 0,
      pendingProjectName: projectName,
      currentProjectId: newProjectId(),
      intake: data,
      roofs: [], templates: [], drafts: [],
      activeRoofId: null, activeTemplateId: null, activeDraftId: null,
      _resume: null,
    });
    setScreen('planner');
  }, []);

  const backToDash = useCallback(() => {
    store.set({
      selectedModel: null, loaded: false, currentProjectId: null,
      roofs: [], templates: [], drafts: [], intake: null,
      activeRoofId: null, activeTemplateId: null, activeDraftId: null,
      draftEditing: false,
    });
    setScreen('dashboard');
  }, []);

  usePlannerBackDetect(screen, backToDash);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={screen}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.08 }}
      >
        {screen === 'login' && <Login onLogin={handleLogin} />}
        {screen === 'dashboard' && (
          <Dashboard
            email={email}
            onLogout={handleLogout}
            onOpenProject={handleOpenProject}
            onNewProject={handleNewProject}
          />
        )}
        {screen === 'intake' && (
          <IntakePro
            onComplete={handleIntakeComplete}
            onBack={backToDash}
          />
        )}
        {screen === 'planner' && (
          <div style={{ position: 'fixed', inset: 0 }}>
            <SolarPlanner />
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
