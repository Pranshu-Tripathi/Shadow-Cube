import type { Project, Workspace } from '../types';

export function Sidebar({ projects, workspaces, activeId, connected, onSelect, onNew }: {
  projects: Project[];
  workspaces: Workspace[];
  activeId: string | null;
  connected: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const projectIds = new Set(projects.map((project) => project.id));
  const groups = [...projects];
  if (workspaces.some((workspace) => !projectIds.has(workspace.projectId))) {
    groups.push({ id: 'global', name: 'Global / no project', path: null, configured: false, workspaceCount: 0, bootstrapCommands: [] });
  }
  return (
    <aside className="sidebar">
      <div className="brand"><div className="cube-mark">◆</div><div><strong>Shadow Cube</strong><span>Agent workspace</span></div></div>
      <button className="primary full" onClick={onNew}>＋ New workspace</button>
      <nav className="project-list" aria-label="Projects and workspaces">
        {groups.map((project) => {
          const children = workspaces.filter((workspace) => workspace.projectId === project.id);
          if (!children.length) return null;
          return <section className="project-group" key={project.id}>
            <div className="project-heading"><span>{project.name}</span><small>{children.length}</small></div>
            {children.map((workspace) => <button
              key={workspace.id}
              className={`workspace-link ${workspace.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(workspace.id)}
            >
              <span className="workspace-name">{workspace.name}</span>
              <span className="workspace-meta">{workspace.provider}{workspace.broadcastDiscord ? ' · Discord' : ''}</span>
            </button>)}
          </section>;
        })}
      </nav>
      <div className="connection"><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? 'Connected' : 'Reconnecting…'}</div>
    </aside>
  );
}
