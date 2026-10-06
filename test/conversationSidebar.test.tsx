import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationSidebar } from '../web/src/components/ConversationSidebar';
import { Sidebar } from '../web/src/components/Sidebar';
import type { Conversation, Project, Workspace } from '../web/src/types';

const workspace = { id: 'workspace', name: 'Workspace' } as Workspace;
const conversations: Conversation[] = [
  { id: 'ready', name: 'Ready chat', source: 'web', provider: 'claude' },
  { id: 'waiting', name: 'Needs input', source: 'web', provider: 'codex' },
];

describe('conversation sidebar attention state', () => {
  test('highlights a chat that is waiting for a question or approval answer', () => {
    const html = renderToStaticMarkup(<ConversationSidebar
      workspace={workspace}
      conversations={conversations}
      activeId="waiting"
      waitingIds={new Set(['waiting'])}
      onSelect={() => {}}
      onNew={() => {}}
    />);

    expect(html).toContain('conversation-link active waiting');
    expect(html).toContain('Needs input, waiting for answer');
    expect(html).toContain('Waiting for answer');
    expect(html).toContain('attention-dot');
  });

  test('propagates attention to the workspace and its project group', () => {
    const projects = [{ id: 'project', name: 'Project' }] as Project[];
    const workspaces = [{ ...workspace, projectId: 'project', provider: 'codex', broadcastDiscord: true }] as Workspace[];
    const html = renderToStaticMarkup(<Sidebar
      projects={projects}
      workspaces={workspaces}
      activeId="workspace"
      waitingIds={new Set(['workspace'])}
      connected
      onSelect={() => {}}
      onNew={() => {}}
    />);

    expect(html).toContain('project-heading waiting');
    expect(html).toContain('project-workspaces expanded');
    expect(html).toContain('workspace-link active waiting');
    expect(html).toContain('Workspace, waiting for an answer');
    expect(html).toContain('Waiting for answer');
  });
});
