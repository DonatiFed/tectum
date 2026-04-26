import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Plus, Search, LogOut, MapPin, Calendar, ChevronRight } from 'lucide-react';
import { type Project, loadProjects } from '../lib/store';
import { fmtEUR } from '../lib/solar';

type StatusFilter = 'all' | 'draft' | 'quoted' | 'signed';

const STATUS_STYLE = {
  draft:  { label: 'Draft',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  quoted: { label: 'Quoted', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  signed: { label: 'Signed', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

interface DashboardProps {
  email: string;
  onLogout: () => void;
  onSelectProject: (project: Project) => void;
  onNewProject: () => void;
}

export default function Dashboard({ email, onLogout, onSelectProject, onNewProject }: DashboardProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const projects = useMemo(() => loadProjects(), []);

  const filtered = useMemo(() => {
    let list = projects;
    if (filter !== 'all') list = list.filter(p => p.status === filter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.customerName.toLowerCase().includes(q) || p.address.toLowerCase().includes(q));
    }
    return list;
  }, [projects, filter, search]);

  const stats = useMemo(() => ({
    total: projects.length,
    signed: projects.filter(p => p.status === 'signed').length,
    revenue: projects.filter(p => p.status === 'signed').reduce((s, p) => s + p.totalCost, 0),
    kwp: projects.reduce((s, p) => s + p.kwp, 0),
  }), [projects]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Tectum" className="w-8 h-8" />
            <span className="font-display text-2xl">tectum</span>
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

      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Title row */}
        <div className="flex items-end justify-between mb-10">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="font-display text-5xl mb-1">Projects</h1>
            <p className="text-muted-foreground text-[15px]">{stats.total} projects · {stats.signed} signed · {fmtEUR(stats.revenue)} revenue</p>
          </motion.div>
          <motion.button
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
            onClick={onNewProject}
            className="h-10 px-5 rounded-xl bg-primary text-primary-foreground font-semibold text-[14px] flex items-center gap-2 hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" /> New project
          </motion.button>
        </div>

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}
          className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6"
        >
          <div className="flex items-center gap-1.5">
            {(['all', 'draft', 'quoted', 'signed'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                  filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
                }`}
              >
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div className="relative flex-1 sm:max-w-xs ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full h-10 pl-9 pr-4 rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 transition-all text-[14px]"
            />
          </div>
        </motion.div>

        {/* Table */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-card rounded-2xl border overflow-hidden"
        >
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left px-6 py-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-muted-foreground">Customer</th>
                <th className="text-left px-4 py-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-muted-foreground hidden md:table-cell">System</th>
                <th className="text-left px-4 py-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-muted-foreground hidden lg:table-cell">Cost</th>
                <th className="text-left px-4 py-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-muted-foreground hidden sm:table-cell">Updated</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((project, i) => {
                const st = STATUS_STYLE[project.status];
                return (
                  <motion.tr
                    key={project.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.05 + i * 0.03 }}
                    onClick={() => onSelectProject(project)}
                    className="border-b last:border-0 hover:bg-secondary/40 cursor-pointer transition-colors group"
                  >
                    <td className="px-6 py-4">
                      <div className="font-semibold text-[14px] text-foreground">{project.customerName}</div>
                      <div className="flex items-center gap-1 text-[12px] text-muted-foreground mt-0.5">
                        <MapPin className="w-3 h-3" />{project.address}
                      </div>
                    </td>
                    <td className="px-4 py-4 hidden md:table-cell">
                      <span className="text-[14px] text-foreground font-medium">{project.kwp} kWp</span>
                      <span className="text-[12px] text-muted-foreground ml-2">+ {project.batteryKwh} kWh</span>
                    </td>
                    <td className="px-4 py-4 hidden lg:table-cell">
                      <span className="text-[14px] text-foreground font-medium">{fmtEUR(project.totalCost)}</span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold border ${st.cls}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-4 hidden sm:table-cell">
                      <div className="flex items-center gap-1 text-[12px] text-muted-foreground">
                        <Calendar className="w-3 h-3" />{project.updatedAt}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-primary transition-colors" />
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-[14px]">No projects found.</div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
