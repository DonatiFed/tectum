import { type IntakeData } from './solar';

export interface Project {
  id: string;
  customerName: string;
  address: string;
  status: 'draft' | 'quoted' | 'signed';
  createdAt: string;
  updatedAt: string;
  kwp: number;
  batteryKwh: number;
  totalCost: number;
  intake: IntakeData;
}

const STORAGE_KEY = 'tectum.projects.v1';

export function loadProjects(): Project[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveProjects(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function addProject(intake: IntakeData): Project {
  const projects = loadProjects();
  const project: Project = {
    id: crypto.randomUUID(),
    customerName: intake.name || 'New Project',
    address: intake.address || 'No address',
    status: 'draft',
    createdAt: new Date().toISOString().slice(0, 10),
    updatedAt: new Date().toISOString().slice(0, 10),
    kwp: 0,
    batteryKwh: 0,
    totalCost: 0,
    intake,
  };
  projects.unshift(project);
  saveProjects(projects);
  return project;
}

export function updateProject(id: string, updates: Partial<Project>) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx !== -1) {
    projects[idx] = { ...projects[idx], ...updates, updatedAt: new Date().toISOString().slice(0, 10) };
    saveProjects(projects);
  }
}
