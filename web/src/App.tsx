import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, jsonBody } from './api';
import type { Approval, Conversation, Message, Project, Provider, Question, Workspace } from './types';
import { Sidebar } from './components/Sidebar';
import { MessageList } from './components/MessageList';
import { Composer } from './components/Composer';
import { NewWorkspaceDialog } from './components/NewWorkspaceDialog';
import { SettingsDialog } from './components/SettingsDialog';

type Frame = Partial<Message> & { type: string; workspaceId?: string; convId?: string; questions?: Question[]; title?: string; token?: string; options?: Approval['options']; decision?: string };

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [questions, setQuestions] = useState<Record<string, Question[]>>({});
  const [approvals, setApprovals] = useState<Record<string, Approval>>({});
  const [connected, setConnected] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const conversationIds = useRef<string[]>([]);
  const reconnectTimer = useRef<number | undefined>(undefined);
  const legacyProviders = useRef<Record<string, Provider>>((() => {
    try { return JSON.parse(localStorage.getItem('sc.providers') || '{}'); } catch { return {}; }
  })());
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null;
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) || null;

  const loadProjects = useCallback(async () => {
    const result = await api<{ projects: Project[] }>('/api/projects'); setProjects(result.projects);
  }, []);
  const loadWorkspaces = useCallback(async () => {
    const result = await api<{ workspaces: Workspace[] }>('/api/workspaces'); setWorkspaces(result.workspaces);
    return result.workspaces;
  }, []);

  const handleFrame = useCallback((frame: Frame) => {
    if (!frame.convId) return;
    const convId = frame.convId;
    if (frame.type === 'question') return setQuestions((current) => ({ ...current, [convId]: frame.questions || [] }));
    if (frame.type === 'question.resolved') return setQuestions((current) => { const next = { ...current }; delete next[convId]; return next; });
    if (frame.type === 'approval') return setApprovals((current) => ({ ...current, [convId]: { token: frame.token || '', content: frame.content || '', options: frame.options || [] } }));
    if (frame.type === 'approval.resolved') return setApprovals((current) => { const next = { ...current }; delete next[convId]; return next; });
    if (frame.type === 'conversation.updated') {
      setConversations((current) => current.map((conversation) => conversation.id === convId ? { ...conversation, name: frame.title || conversation.name } : conversation));
      return;
    }
    if (frame.type !== 'message.create' && frame.type !== 'message.update') return;
    setMessages((current) => {
      const list = [...(current[convId] || [])];
      const index = list.findIndex((message) => message.msgId === frame.msgId);
      const nextMessage = { msgId: frame.msgId || `${Date.now()}`, role: frame.role, content: frame.content || '', kind: frame.kind, title: frame.title } as Message;
      if (index >= 0) list[index] = { ...list[index], ...nextMessage }; else list.push(nextMessage);
      return { ...current, [convId]: list };
    });
    setConversations((current) => current.map((conversation) => conversation.id === convId ? { ...conversation, hasMessages: true } : conversation));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      socket.current = ws;
      ws.onopen = () => { if (cancelled) return ws.close(); setConnected(true); conversationIds.current.forEach((convId) => ws.send(JSON.stringify({ type: 'subscribe', convId }))); };
      ws.onmessage = (event) => { try { handleFrame(JSON.parse(event.data)); } catch { /* ignore malformed frames */ } };
      ws.onclose = () => { setConnected(false); if (!cancelled) reconnectTimer.current = window.setTimeout(connect, 1500); };
    };
    connect();
    return () => { cancelled = true; if (reconnectTimer.current) clearTimeout(reconnectTimer.current); socket.current?.close(); };
  }, [handleFrame]);

  useEffect(() => { conversationIds.current = conversations.map((conversation) => conversation.id); }, [conversations]);

  useEffect(() => {
    Promise.all([loadProjects(), loadWorkspaces(), api<{ voice: boolean }>('/api/health').then((health) => setVoiceEnabled(health.voice))])
      .then(([, available]) => { if (!activeWorkspaceId && available.length) void selectWorkspace(available[0].id); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Failed to load application state.'));
  }, []);

  const openConversation = async (workspaceId: string, conversationId: string) => {
    setActiveConversationId(conversationId);
    if (!messages[conversationId]) {
      const result = await api<{ messages: Message[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/history`);
      setMessages((current) => ({ ...current, [conversationId]: result.messages || [] }));
    }
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'subscribe', convId: conversationId }));
  };

  const selectWorkspace = async (workspaceId: string) => {
    setActiveWorkspaceId(workspaceId); setSettingsOpen(false); setError('');
    try {
      const result = await api<{ conversations: Conversation[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/conversations`);
      setConversations(result.conversations);
      if (result.conversations[0]) await openConversation(workspaceId, result.conversations[0].id);
      else setActiveConversationId(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open workspace.'); }
  };

  const createConversation = async () => {
    if (!activeWorkspace) return;
    try {
      const result = await api<{ conversation: Conversation }>(`/api/workspaces/${encodeURIComponent(activeWorkspace.id)}/conversations`, { method: 'POST', body: '{}' });
      setConversations((current) => current.some((item) => item.id === result.conversation.id) ? current : [...current, result.conversation]);
      await openConversation(activeWorkspace.id, result.conversation.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create conversation.'); }
  };

  const updateWorkspace = (workspace: Workspace) => setWorkspaces((current) => current.map((item) => item.id === workspace.id ? workspace : item));
  const provider = (activeConversation?.provider || (activeConversationId ? legacyProviders.current[activeConversationId] : null) || activeWorkspace?.provider || 'claude') as Provider;
  const updateProvider = async (next: Provider) => {
    if (!activeWorkspace || !activeConversationId) return;
    await api(`/api/workspaces/${encodeURIComponent(activeWorkspace.id)}/conversations/${encodeURIComponent(activeConversationId)}`, { method: 'PATCH', body: jsonBody({ provider: next }) });
    legacyProviders.current[activeConversationId] = next;
    setConversations((current) => current.map((item) => item.id === activeConversationId ? { ...item, provider: next } : item));
  };
  const send = async (prompt: string) => {
    if (!activeWorkspace || !activeConversationId) return;
    await api(`/api/workspaces/${encodeURIComponent(activeWorkspace.id)}/conversations/${encodeURIComponent(activeConversationId)}/prompt`, { method: 'POST', body: jsonBody({ prompt, provider }) });
  };
  const answer = async (answers: Record<string, string | string[]>) => {
    if (!activeWorkspace || !activeConversationId) return;
    await api(`/api/workspaces/${encodeURIComponent(activeWorkspace.id)}/conversations/${encodeURIComponent(activeConversationId)}/answer`, { method: 'POST', body: jsonBody({ answers }) });
    setQuestions((current) => { const next = { ...current }; delete next[activeConversationId]; return next; });
  };
  const approve = async (decision: string) => {
    if (!activeWorkspace || !activeConversationId) return;
    await api(`/api/workspaces/${encodeURIComponent(activeWorkspace.id)}/conversations/${encodeURIComponent(activeConversationId)}/approval`, { method: 'POST', body: jsonBody({ decision }) });
  };
  const groupedTitle = useMemo(() => projects.find((project) => project.id === activeWorkspace?.projectId)?.name || activeWorkspace?.projectName, [projects, activeWorkspace]);

  return <div className="app-shell">
    <Sidebar projects={projects} workspaces={workspaces} activeId={activeWorkspaceId} connected={connected} onSelect={(id) => void selectWorkspace(id)} onNew={() => setNewWorkspaceOpen(true)} />
    <main className="main-panel">
      {!activeWorkspace ? <div className="app-empty"><div className="empty-cube">◆</div><h1>Choose a workspace</h1><p>Select an existing workspace or create a new one.</p></div> : <>
        <header className="workspace-header">
          <div className="workspace-title"><span>{groupedTitle}</span><h1>{activeWorkspace.name}</h1></div>
          <div className="header-actions">
            <label className="compact-select">Provider<select value={provider} onChange={(event) => void updateProvider(event.target.value as Provider)}><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
            <label className="broadcast-control" title="Broadcast to Discord"><input type="checkbox" checked={activeWorkspace.broadcastDiscord} onChange={(event) => void api<{ workspace: Workspace }>(`/api/workspaces/${encodeURIComponent(activeWorkspace.id)}`, { method: 'PATCH', body: jsonBody({ broadcastDiscord: event.target.checked }) }).then((result) => updateWorkspace(result.workspace)).catch((reason) => setError(reason.message))} /><span>Discord</span></label>
            <button onClick={() => setSettingsOpen(true)}>Settings</button>
          </div>
        </header>
        <div className="conversation-tabs"><div className="tab-scroll">{conversations.map((conversation, index) => <button className={conversation.id === activeConversationId ? 'active' : ''} key={conversation.id} onClick={() => void openConversation(activeWorkspace.id, conversation.id)}>{conversation.name || `Chat ${index + 1}`}{conversation.source === 'discord' && <span className="tiny-badge">D</span>}</button>)}</div><button className="new-chat" onClick={() => void createConversation()}>＋</button></div>
        {error && <div className="global-error">{error}<button onClick={() => setError('')}>×</button></div>}
        <MessageList messages={activeConversationId ? messages[activeConversationId] || [] : []} questions={activeConversationId ? questions[activeConversationId] : undefined} approval={activeConversationId ? approvals[activeConversationId] : undefined} onAnswer={answer} onApprove={approve} />
        <Composer workspaceId={activeWorkspace.id} disabled={!activeConversationId} voiceEnabled={voiceEnabled} onSend={async (text) => { try { setError(''); await send(text); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Message failed.'); throw reason; } }} />
      </>}
    </main>
    {newWorkspaceOpen && <NewWorkspaceDialog projects={projects} onClose={() => setNewWorkspaceOpen(false)} onCreated={(workspace) => { setNewWorkspaceOpen(false); setWorkspaces((current) => [...current, workspace]); void loadProjects(); void selectWorkspace(workspace.id); }} />}
    {settingsOpen && activeWorkspace && <SettingsDialog workspace={activeWorkspace} projects={projects} conversationId={activeConversationId} onClose={() => setSettingsOpen(false)} onWorkspace={updateWorkspace} onProjects={loadProjects} />}
  </div>;
}
