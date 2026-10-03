import { useMemo, useState } from 'react';
import { api, jsonBody } from '../api';
import type { Project, Provider, Workspace } from '../types';
import { Modal } from './Modal';

export function NewWorkspaceDialog({ projects, onClose, onCreated }: { projects: Project[]; onClose: () => void; onCreated: (workspace: Workspace) => void }) {
  const choices = useMemo(() => projects.filter((project) => project.configured), [projects]);
  const [projectId, setProjectId] = useState(choices[0]?.id || '');
  const selected = choices.find((project) => project.id === projectId);
  const [name, setName] = useState(selected?.name || '');
  const [customName, setCustomName] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [provider, setProvider] = useState<Provider>('claude');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const result = await api<{ workspace: Workspace }>('/api/workspaces', { method: 'POST', body: jsonBody({
        projectId: projectId || undefined,
        projectName: projectId ? undefined : customName,
        projectDir: projectId ? undefined : customPath,
        name: name.trim() || selected?.name || customName,
        baseBranch: baseBranch.trim() || undefined,
        provider,
      }) });
      onCreated(result.workspace);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create workspace.'); }
    finally { setBusy(false); }
  };
  return <Modal title="Create workspace" onClose={onClose}>
    <div className="modal-body form-stack">
      <label>Project<select value={projectId} onChange={(event) => { const id = event.target.value; setProjectId(id); const project = choices.find((item) => item.id === id); if (project) setName(project.name); }}><option value="">Custom repository…</option>{choices.map((project) => <option key={project.id} value={project.id}>{project.name} — {project.path}</option>)}</select></label>
      {!projectId && <div className="form-grid"><label>Project name<input value={customName} onChange={(event) => setCustomName(event.target.value)} /></label><label>Repository path<input value={customPath} onChange={(event) => setCustomPath(event.target.value)} placeholder="/path/to/repository" /></label></div>}
      <label>Workspace name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="feature-name" /><small>Used for the worktree folder and branch.</small></label>
      <div className="form-grid"><label>Base branch<input value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} placeholder="Repository default" /></label><label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}><option value="claude">Claude</option><option value="codex">Codex</option></select></label></div>
      {error && <div className="form-error">{error}</div>}
    </div>
    <footer className="modal-footer"><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || (!projectId && (!customName || !customPath))} onClick={() => void submit()}>{busy ? 'Creating…' : 'Create workspace'}</button></footer>
  </Modal>;
}
