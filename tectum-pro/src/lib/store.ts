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

const SAMPLE_PROJECTS: Project[] = [
  {
    id: '1', customerName: 'Müller Family', address: 'Berliner Str. 42, 10115 Berlin',
    status: 'signed', createdAt: '2026-04-18', updatedAt: '2026-04-22',
    kwp: 11.7, batteryKwh: 10, totalCost: 24610,
    intake: { name: 'Thomas Müller', email: 'mueller@mail.de', isOwner: true, numPeople: 4, houseSize: 160, address: 'Berliner Str. 42, 10115 Berlin', postalCode: '10115', roofType: 'gable', roofArea: 85, orientation: 'S', monthlyBill: 180, evStatus: 'has', batteryStatus: 'wants', batteryCapacityKwh: 10, heatingType: 'gas', wantsHeatPump: false },
  },
  {
    id: '2', customerName: 'Schmidt Residence', address: 'Goethestr. 15, 80336 München',
    status: 'quoted', createdAt: '2026-04-20', updatedAt: '2026-04-24',
    kwp: 8.6, batteryKwh: 5, totalCost: 17850,
    intake: { name: 'Anna Schmidt', email: 'schmidt@mail.de', isOwner: true, numPeople: 2, houseSize: 110, address: 'Goethestr. 15, 80336 München', postalCode: '80336', roofType: 'hip', roofArea: 65, orientation: 'SE', monthlyBill: 130, evStatus: 'none', batteryStatus: 'wants', batteryCapacityKwh: 5, heatingType: 'gas', wantsHeatPump: true },
  },
  {
    id: '3', customerName: 'Weber Household', address: 'Rheinweg 8, 50667 Köln',
    status: 'draft', createdAt: '2026-04-23', updatedAt: '2026-04-23',
    kwp: 6.45, batteryKwh: 10, totalCost: 19200,
    intake: { name: 'Klaus Weber', email: 'weber@mail.de', isOwner: true, numPeople: 3, houseSize: 140, address: 'Rheinweg 8, 50667 Köln', postalCode: '50667', roofType: 'flat', roofArea: 70, orientation: 'SW', monthlyBill: 160, evStatus: 'wants', batteryStatus: 'wants', batteryCapacityKwh: 10, heatingType: 'oil', wantsHeatPump: true },
  },
  {
    id: '4', customerName: 'Fischer Family', address: 'Lindenallee 22, 20146 Hamburg',
    status: 'quoted', createdAt: '2026-04-15', updatedAt: '2026-04-21',
    kwp: 13.5, batteryKwh: 15, totalCost: 31400,
    intake: { name: 'Maria Fischer', email: 'fischer@mail.de', isOwner: true, numPeople: 5, houseSize: 200, address: 'Lindenallee 22, 20146 Hamburg', postalCode: '20146', roofType: 'gable', roofArea: 100, orientation: 'S', monthlyBill: 250, evStatus: 'has', batteryStatus: 'wants', batteryCapacityKwh: 15, heatingType: 'gas', wantsHeatPump: true },
  },
  {
    id: '5', customerName: 'Bauer Residence', address: 'Schillerplatz 3, 70173 Stuttgart',
    status: 'signed', createdAt: '2026-04-10', updatedAt: '2026-04-19',
    kwp: 9.9, batteryKwh: 10, totalCost: 22100,
    intake: { name: 'Hans Bauer', email: 'bauer@mail.de', isOwner: true, numPeople: 3, houseSize: 130, address: 'Schillerplatz 3, 70173 Stuttgart', postalCode: '70173', roofType: 'gable', roofArea: 78, orientation: 'SW', monthlyBill: 170, evStatus: 'wants', batteryStatus: 'wants', batteryCapacityKwh: 10, heatingType: 'electric', wantsHeatPump: false },
  },
  {
    id: '6', customerName: 'Hoffmann Family', address: 'Parkstr. 11, 04109 Leipzig',
    status: 'draft', createdAt: '2026-04-24', updatedAt: '2026-04-24',
    kwp: 5.4, batteryKwh: 5, totalCost: 14300,
    intake: { name: 'Peter Hoffmann', email: 'hoffmann@mail.de', isOwner: true, numPeople: 2, houseSize: 90, address: 'Parkstr. 11, 04109 Leipzig', postalCode: '04109', roofType: 'shed', roofArea: 50, orientation: 'E', monthlyBill: 100, evStatus: 'none', batteryStatus: 'wants', batteryCapacityKwh: 5, heatingType: 'gas', wantsHeatPump: false },
  },
];

export function loadProjects(): Project[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SAMPLE_PROJECTS));
  return SAMPLE_PROJECTS;
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
