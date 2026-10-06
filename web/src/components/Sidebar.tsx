import { useEffect, useMemo, useState } from 'react';
import type { Project, Workspace } from '../types';

export function Sidebar({ projects, workspaces, activeId, waitingIds, connected, onSelect, onNew }: {
  projects: Project[];
  workspaces: Workspace[];
  activeId: string | null;
  waitingIds: ReadonlySet<string>;
  connected: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const projectIds = new Set(projects.map((project) => project.id));
  const groups = [...projects];
  if (workspaces.some((workspace) => !projectIds.has(workspace.projectId))) {
    groups.push({ id: 'global', name: 'Global / no project', path: null, configured: false, workspaceCount: 0, bootstrapCommands: [] });
  }
  const activeProjectId = workspaces.find((workspace) => workspace.id === activeId)?.projectId;
  const waitingProjectIds = useMemo(() => new Set(
    workspaces.filter((workspace) => waitingIds.has(workspace.id)).map((workspace) => workspace.projectId)
  ), [workspaces, waitingIds]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([
    ...(activeProjectId ? [activeProjectId] : []),
    ...waitingProjectIds,
  ]));

  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      let changed = false;
      if (activeProjectId && !next.has(activeProjectId)) { next.add(activeProjectId); changed = true; }
      waitingProjectIds.forEach((projectId) => {
        if (!next.has(projectId)) { next.add(projectId); changed = true; }
      });
      return changed ? next : current;
    });
  }, [activeProjectId, waitingProjectIds]);

  const toggleProject = (projectId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  };

  return (
    <aside className="sidebar">
      <div className="brand"><div className="cube-mark">◆</div><div><strong>Shadow Cube</strong><span>Agent workspace</span></div></div>
      <button className="primary full" onClick={onNew}>＋ New workspace</button>
      <nav className="project-list" aria-label="Projects and workspaces">
        {groups.map((project) => {
          const children = workspaces.filter((workspace) => workspace.projectId === project.id);
          if (!children.length) return null;
          const isExpanded = expanded.has(project.id);
          const projectWaiting = waitingProjectIds.has(project.id);
          return <section className="project-group" key={project.id}>
            <button className={`project-heading ${projectWaiting ? 'waiting' : ''}`} type="button" aria-expanded={isExpanded} aria-label={`${project.name}${projectWaiting ? ', contains a workspace waiting for an answer' : ''}`} onClick={() => toggleProject(project.id)}>
              <span className="project-chevron" aria-hidden="true">›</span>
              <span className="project-label">{project.name}</span>
              <small>{children.length}</small>
            </button>
            <div className={`project-workspaces ${isExpanded ? 'expanded' : ''}`}>
              {children.map((workspace) => {
                const waiting = waitingIds.has(workspace.id);
                return <button
                  key={workspace.id}
                  className={`workspace-link ${workspace.id === activeId ? 'active' : ''} ${waiting ? 'waiting' : ''}`}
                  aria-label={`${workspace.name}${waiting ? ', waiting for an answer' : ''}`}
                  onClick={() => onSelect(workspace.id)}
                >
                  <span className="workspace-name">{workspace.name}{waiting && <span className="attention-dot" aria-hidden="true" />}</span>
                  <span className="workspace-meta">{waiting ? 'Waiting for answer' : `${workspace.provider}${workspace.broadcastDiscord ? ' · Discord' : ''}`}</span>
                </button>;
              })}
            </div>
          </section>;
        })}
      </nav>
      <div className="connection"><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? 'Connected' : 'Reconnecting…'}</div>
    </aside>
  );
}
