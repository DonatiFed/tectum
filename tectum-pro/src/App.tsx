import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { IntakePro } from './components/IntakePro';
import { PlannerPro } from './components/PlannerPro';
import { type IntakeData } from './lib/solar';
import { type Project, addProject } from './lib/store';

type Screen = 'login' | 'dashboard' | 'intake' | 'planner';

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [email, setEmail] = useState('');
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [intake, setIntake] = useState<IntakeData | null>(null);

  const handleLogin = (userEmail: string) => {
    setEmail(userEmail);
    setScreen('dashboard');
  };

  const handleSelectProject = (project: Project) => {
    setActiveProject(project);
    setIntake(project.intake);
    setScreen('planner');
  };

  const handleIntakeComplete = (data: IntakeData) => {
    const project = addProject(data);
    setActiveProject(project);
    setIntake(data);
    setScreen('planner');
  };

  const backToDash = () => {
    setActiveProject(null);
    setIntake(null);
    setScreen('dashboard');
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={screen}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        {screen === 'login' && <Login onLogin={handleLogin} />}
        {screen === 'dashboard' && (
          <Dashboard email={email} onLogout={() => { setScreen('login'); setEmail(''); }}
            onSelectProject={handleSelectProject} onNewProject={() => setScreen('intake')} />
        )}
        {screen === 'intake' && (
          <IntakePro onComplete={handleIntakeComplete} onBack={backToDash} initial={activeProject?.intake} />
        )}
        {screen === 'planner' && intake && (
          <PlannerPro intake={intake} onBack={backToDash} projectName={activeProject?.customerName} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
