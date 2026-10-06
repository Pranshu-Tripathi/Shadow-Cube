import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationSidebar } from '../web/src/components/ConversationSidebar';
import type { Conversation, Workspace } from '../web/src/types';

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
});
