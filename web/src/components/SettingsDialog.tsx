import { useEffect, useState, type ReactNode } from 'react';
import { api, jsonBody } from '../api';
import type { Project, Provider, Workspace } from '../types';
import { Modal } from './Modal';

type Section = 'general' | 'agent' | 'discord' | 'bootstrap' | 'rules' | 'memory' | 'worktree' | 'danger';
const sections: Array<[Section, string]> = [['general', 'General'], ['agent', 'Agent'], ['discord', 'Discord'], ['bootstrap', 'Bootstrap'], ['rules', 'Rules'], ['memory', 'Memory'], ['worktree', 'Worktree'], ['danger', 'Danger zone']];

export function SettingsDialog({ workspace, projects, conversationId, onClose, onWorkspace, onProjects }: {
  workspace: Workspace;
  projects: Project[];
  conversationId: string | null;
  onClose: () => void;
  onWorkspace: (workspace: Workspace) => void;
  onProjects: () => Promise<void>;
}) {
  const [section, setSection] = useState<Section>('general');
  const [name, setName] = useState(workspace.name);
  const [projectId, setProjectId] = useState(workspace.projectId);
  const [provider, setProvider] = useState<Provider>(workspace.provider);
  const [baseBranch, setBaseBranch] = useState(workspace.baseBranch || '');
  const project = projects.find((item) => item.id === projectId);
  const [commands, setCommands] = useState((project?.bootstrapCommands || []).join('\n'));
  const [repo, setRepo] = useState(workspace.rulesRepo || '');
  const [rulesPath, setRulesPath] = useState(workspace.rulesPath || '');
  const [pullPrompt, setPullPrompt] = useState(true);
  const [pullSkills, setPullSkills] = useState(true);
  const [memory, setMemory] = useState<Array<{ name: string; content: string }>>([]);
  const [newMemory, setNewMemory] = useState('');
  const [preview, setPreview] = useState<{ exists?: boolean; worktreePath?: string; branch?: string; dirtyFiles?: number } | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<void>) => { setBusy(true); setStatus(''); try { await work(); } catch (error) { setStatus(`Error: ${error instanceof Error ? error.message : 'Request failed.'}`); } finally { setBusy(false); } };
  const loadPreview = async () => setPreview(await api(`/api/workspaces/${encodeURIComponent(workspace.id)}/actions/preview`));
  const loadMemory = async () => { const result = await api<{ memory: Array<{ name: string; content: string }> }>(`/api/workspaces/${encodeURIComponent(workspace.id)}/memory`); setMemory(result.memory || []); };
  useEffect(() => { if (section === 'worktree' || section === 'danger') void loadPreview(); if (section === 'memory') void loadMemory(); }, [section]);

  const saveWorkspace = () => act(async () => {
    const result = await api<{ workspace: Workspace }>(`/api/workspaces/${encodeURIComponent(workspace.id)}`, { method: 'PATCH', body: jsonBody({ name, projectId, provider, baseBranch }) });
    onWorkspace(result.workspace); setStatus('Saved.');
  });
  const lifecycle = (action: 'reset' | 'remove-worktree' | 'destroy') => act(async () => {
    if (action !== 'reset') {
      const warning = `${action === 'destroy' ? 'Destroy' : 'Remove'} worktree${preview?.dirtyFiles ? ` and discard ${preview.dirtyFiles} uncommitted file(s)` : ''}?\n\n${preview?.worktreePath || ''}`;
      if (!window.confirm(warning)) return;
    }
    const result = await api<{ removed?: boolean; confirmationRequired?: boolean }>(`/api/workspaces/${encodeURIComponent(workspace.id)}/actions/${action}`, { method: 'POST', body: jsonBody({ conversationId, confirmPath: preview?.worktreePath }) });
    setStatus(result.confirmationRequired ? 'Additional confirmation required.' : 'Action completed.'); await loadPreview();
  });

  return <Modal title={`Settings · ${workspace.name}`} onClose={onClose} wide>
    <div className="settings-layout">
      <nav className="settings-nav">{sections.map(([id, label]) => <button className={section === id ? 'active' : ''} key={id} onClick={() => setSection(id)}>{label}</button>)}</nav>
      <div className="settings-content">
        {section === 'general' && <SettingsSection title="General" description="Workspace identity and source repository."><label>Workspace name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Project<select value={projectId} onChange={(event) => { setProjectId(event.target.value); const selected = projects.find((item) => item.id === event.target.value); setCommands((selected?.bootstrapCommands || []).join('\n')); }}>{projects.map((item) => <option value={item.id} key={item.id}>{item.name}{item.path ? ` — ${item.path}` : ''}</option>)}</select></label><button className="primary align-start" disabled={busy} onClick={saveWorkspace}>Save general settings</button></SettingsSection>}
        {section === 'agent' && <SettingsSection title="Agent" description="Defaults for new conversations in this workspace."><label>Default provider<select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}><option value="claude">Claude</option><option value="codex">Codex</option></select></label><label>Base branch<input value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} placeholder="Repository default" /></label><button className="primary align-start" disabled={busy} onClick={saveWorkspace}>Save agent settings</button></SettingsSection>}
        {section === 'discord' && <SettingsSection title="Discord" description="Mirror this workspace so conversations can be continued from your phone."><div className="setting-row"><div><strong>Broadcast conversations</strong><p>Messages, questions, and approvals are mirrored bidirectionally.</p></div><input type="checkbox" checked={workspace.broadcastDiscord} onChange={(event) => void act(async () => { const result = await api<{ workspace: Workspace }>(`/api/workspaces/${encodeURIComponent(workspace.id)}`, { method: 'PATCH', body: jsonBody({ broadcastDiscord: event.target.checked }) }); onWorkspace(result.workspace); })} /></div><Info label="Discord channel" value={workspace.discordChannelId || 'Created when broadcasting is enabled'} /></SettingsSection>}
        {section === 'bootstrap' && <SettingsSection title="Initial commands" description="Run sequentially once after a new worktree is created. .out is always created first."><label>Commands<textarea rows={8} value={commands} onChange={(event) => setCommands(event.target.value)} placeholder={'bun install\nbun run prepare'} /></label><div className="button-row"><button className="primary" disabled={busy || projectId === 'global'} onClick={() => void act(async () => { await api(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: jsonBody({ bootstrapCommands: commands.split('\n').map((value) => value.trim()).filter(Boolean) }) }); await onProjects(); setStatus('Bootstrap commands saved.'); })}>Save commands</button><button disabled={busy} onClick={() => void act(async () => { if (!window.confirm('Run the configured commands in this worktree now?')) return; const result = await api<{ status: string; output?: string }>(`/api/workspaces/${encodeURIComponent(workspace.id)}/worktree/bootstrap`, { method: 'POST', body: '{}' }); setStatus(`${result.status}\n${result.output || ''}`); })}>Run again</button></div></SettingsSection>}
        {section === 'rules' && <SettingsSection title="Rules repository" description="Pull a system prompt and skills from a GitHub repository."><label>Repository<input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="owner/repository" /></label><button className="align-start" disabled={busy} onClick={() => void act(async () => { await api(`/api/workspaces/${encodeURIComponent(workspace.id)}/repo/config`, { method: 'POST', body: jsonBody({ repo }) }); setStatus('Repository saved.'); })}>Save repository</button><label>Repository-relative path<input value={rulesPath} onChange={(event) => setRulesPath(event.target.value)} /></label><label className="check-row"><input type="checkbox" checked={pullPrompt} onChange={(event) => setPullPrompt(event.target.checked)} /> Pull system.md</label><label className="check-row"><input type="checkbox" checked={pullSkills} onChange={(event) => setPullSkills(event.target.checked)} /> Pull skills directory</label><button className="primary align-start" disabled={busy} onClick={() => void act(async () => { const result = await api<{ results: string[] }>(`/api/workspaces/${encodeURIComponent(workspace.id)}/repo/pull`, { method: 'POST', body: jsonBody({ path: rulesPath, prompt: pullPrompt, skill: pullSkills }) }); setStatus(result.results.join('\n')); })}>Pull rules</button></SettingsSection>}
        {section === 'memory' && <SettingsSection title="Memory" description="Lasting project guidance layered onto the agent instructions."><div className="memory-list">{memory.length ? memory.map((item) => <article key={item.name}><small>{item.name}</small><p>{item.content}</p></article>) : <p className="muted">No memory saved.</p>}</div><label>Add note<textarea rows={4} value={newMemory} onChange={(event) => setNewMemory(event.target.value)} /></label><div className="button-row"><button className="primary" disabled={!newMemory.trim() || busy} onClick={() => void act(async () => { await api(`/api/workspaces/${encodeURIComponent(workspace.id)}/memory`, { method: 'POST', body: jsonBody({ text: newMemory }) }); setNewMemory(''); await loadMemory(); })}>Add memory</button><button className="danger-text" disabled={!memory.length || busy} onClick={() => void act(async () => { if (!window.confirm('Wipe all memory for this worktree?')) return; await api(`/api/workspaces/${encodeURIComponent(workspace.id)}/memory`, { method: 'DELETE' }); await loadMemory(); })}>Wipe memory</button></div></SettingsSection>}
        {section === 'worktree' && <SettingsSection title="Worktree" description="Inspect and provision the isolated checkout used by this workspace."><Info label="Path" value={preview?.worktreePath || 'Not configured'} /><Info label="Branch" value={preview?.branch || '—'} /><Info label="Status" value={preview?.exists ? `${preview.dirtyFiles || 0} uncommitted files` : 'Not created'} /><button className="primary align-start" disabled={busy} onClick={() => void act(async () => { const result = await api<{ worktreePath: string }>(`/api/workspaces/${encodeURIComponent(workspace.id)}/worktree/setup`, { method: 'POST' }); setStatus(`Worktree ready at ${result.worktreePath}`); await loadPreview(); })}>Set up worktree</button></SettingsSection>}
        {section === 'danger' && <SettingsSection title="Danger zone" description="These actions stop running agents and may remove uncommitted work."><Danger title="Reset session" description="Stop the agent and clear Claude/Codex session state. Message history stays intact." label="Reset session" onClick={() => void lifecycle('reset')} /><Danger title="Remove worktree" description="Reset the session and force-remove the workspace worktree." label="Remove worktree" onClick={() => void lifecycle('remove-worktree')} /><Danger title="Destroy worktree" description="Remove the worktree and fetch the matching remote branch into the main repository." label="Destroy worktree" onClick={() => void lifecycle('destroy')} /></SettingsSection>}
        {status && <pre className={`settings-status ${status.startsWith('Error:') ? 'error' : ''}`}>{status}</pre>}
      </div>
    </div>
  </Modal>;
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) { return <section className="settings-section"><h3>{title}</h3><p className="section-description">{description}</p><div className="form-stack">{children}</div></section>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="info-row"><span>{label}</span><code>{value}</code></div>; }
function Danger({ title, description, label, onClick }: { title: string; description: string; label: string; onClick: () => void }) { return <div className="danger-row"><div><strong>{title}</strong><p>{description}</p></div><button className="danger" onClick={onClick}>{label}</button></div>; }
