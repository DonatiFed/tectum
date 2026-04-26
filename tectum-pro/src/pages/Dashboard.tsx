import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Search, LogOut, MapPin, Calendar, Trash2 } from 'lucide-react';
import { listProjects as listTaimProjects, deleteProject as deleteTaimProject } from '../taim/lib/projects';
import { getInstaller } from '../taim/lib/auth';

interface TaimProject {
  id: string;
  name: string;
  intake: any;
  thumbnail: string | null;
  templates: any[];
  drafts: any[];
  savedAt: number;
  hasModel: boolean;
}

interface DashboardProps {
  email: string;
  onLogout: () => void;
  onOpenProject: (projectId: string) => void;
  onNewProject: () => void;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const THUMB_GRADIENTS = [
  'linear-gradient(135deg, #232d6e 0%, #3b5998 50%, #6b8cce 100%)',
  'linear-gradient(135deg, #1a365d 0%, #2a4a7f 50%, #4a7ab5 100%)',
  'linear-gradient(135deg, #1e3a5f 0%, #2d5a87 50%, #5a8ab5 100%)',
  'linear-gradient(135deg, #2d3748 0%, #4a5568 50%, #718096 100%)',
  'linear-gradient(135deg, #1a202c 0%, #2d3748 50%, #4a5568 100%)',
  'linear-gradient(135deg, #2c3e50 0%, #3498db 50%, #6bb5e0 100%)',
];

export default function Dashboard({ email, onLogout, onOpenProject, onNewProject }: DashboardProps) {
  const [search, setSearch] = useState('');
  const [projects, setProjects] = useState<TaimProject[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    const installer = getInstaller();
    listTaimProjects(installer?.id).then((list: TaimProject[]) => {
      setProjects(list || []);
      setLoading(false);
    });
  };

  useEffect(() => { refresh(); }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this project? This removes the saved 3D model, templates and drafts.')) return;
    await deleteTaimProject(id);
    refresh();
  };

  const filtered = useMemo(() => {
    if (!search) return projects;
    const q = search.toLowerCase();
    return projects.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.intake?.address || '').toLowerCase().includes(q) ||
      (p.intake?.email || '').toLowerCase().includes(q)
    );
  }, [projects, search]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>Tectum</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[13px] text-muted-foreground hidden sm:block">{email}</span>
            <button onClick={onLogout}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Title row */}
        <div className="flex items-end justify-between mb-10">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="font-display text-5xl mb-1">Projects</h1>
            <p className="text-muted-foreground text-[15px]">
              {loading ? 'Loading…' : `${projects.length} project${projects.length !== 1 ? 's' : ''} on this dashboard`}
            </p>
          </motion.div>
          <motion.button
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
            onClick={onNewProject}
            className="h-10 px-5 rounded-xl bg-primary text-primary-foreground font-semibold text-[14px] flex items-center gap-2 hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" /> New project
          </motion.button>
        </div>

        {/* Search */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}
          className="flex items-center gap-3 mb-8"
        >
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search projects..."
              className="w-full h-10 pl-9 pr-4 rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 transition-all text-[14px]"
            />
          </div>
        </motion.div>

        {/* Card grid */}
        <div className="grid gap-5 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
          {/* Add project card */}
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            onClick={onNewProject}
            className="group cursor-pointer rounded-2xl border-2 border-dashed border-border hover:border-primary bg-card/50 hover:bg-primary/[0.03] flex flex-col items-center justify-center gap-3 py-16 transition-all"
          >
            <div className="w-14 h-14 rounded-full bg-secondary group-hover:bg-primary flex items-center justify-center transition-colors">
              <Plus className="w-6 h-6 text-muted-foreground group-hover:text-primary-foreground transition-colors" />
            </div>
            <div className="font-semibold text-[14px] text-muted-foreground group-hover:text-primary transition-colors">
              Add new project
            </div>
            <div className="text-[12px] text-muted-foreground/60 text-center max-w-[200px]">
              Enter client details, upload a 3D model, and start designing.
            </div>
          </motion.div>

          {/* Project cards */}
          {filtered.map((project, i) => {
            const tplCount = project.templates?.length ?? 0;
            const draftCount = project.drafts?.length ?? 0;
            return (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 + i * 0.03 }}
                onClick={() => onOpenProject(project.id)}
                className="group cursor-pointer rounded-2xl border border-border bg-card overflow-hidden hover:border-primary/40 hover:-translate-y-0.5 transition-all shadow-sm hover:shadow-md"
              >
                {/* Thumbnail — real 3D snapshot or gradient fallback */}
                <div
                  className="w-full aspect-[4/3] flex items-center justify-center relative"
                  style={project.thumbnail
                    ? { background: `#f0f0f0 url(${project.thumbnail}) center/cover no-repeat` }
                    : { background: THUMB_GRADIENTS[i % THUMB_GRADIENTS.length] }
                  }
                >
                  {!project.thumbnail && <div className="text-white/20 text-5xl">⌂</div>}
                  <button
                    onClick={(e) => handleDelete(project.id, e)}
                    className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-black/20 hover:bg-red-500/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>

                {/* Card body */}
                <div className="p-4 flex flex-col gap-2">
                  <div className="font-semibold text-[15px] text-foreground leading-tight">
                    {project.name || 'Untitled'}
                  </div>
                  {project.intake?.email && (
                    <div className="text-[12px] text-muted-foreground truncate">
                      ✉ {project.intake.email}
                    </div>
                  )}
                  {project.intake?.address && (
                    <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                      <MapPin className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{project.intake.address}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-secondary text-muted-foreground">
                      📁 {tplCount} template{tplCount !== 1 ? 's' : ''}
                    </span>
                    <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-secondary text-muted-foreground">
                      📄 {draftCount} draft{draftCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60 mt-1 pt-2 border-t border-border/50">
                    <Calendar className="w-3 h-3" />
                    {project.savedAt ? timeAgo(project.savedAt) : ''}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {!loading && filtered.length === 0 && (
          <div className="text-center py-20 text-muted-foreground text-[14px]">No projects yet — start your first one.</div>
        )}
      </div>
    </div>
  );
}
