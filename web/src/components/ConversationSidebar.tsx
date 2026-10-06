import type { Conversation, Workspace } from '../types';

export function ConversationSidebar({ workspace, conversations, activeId, waitingIds, onSelect, onNew }: {
  workspace: Workspace | null;
  conversations: Conversation[];
  activeId: string | null;
  waitingIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return <aside className="conversation-sidebar" aria-label="Chats">
    <div className="conversation-sidebar-header">
      <div>
        <span>{workspace ? workspace.name : 'Workspace'}</span>
        <strong>Chats</strong>
      </div>
      <button type="button" className="new-chat" disabled={!workspace} onClick={onNew} aria-label="New chat" title="New chat">＋</button>
    </div>
    <nav className="conversation-list">
      {!workspace && <p className="conversation-list-empty">Choose a workspace to see its chats.</p>}
      {workspace && !conversations.length && <p className="conversation-list-empty">No chats yet. Start a new one.</p>}
      {conversations.map((conversation, index) => {
        const waiting = waitingIds.has(conversation.id);
        const title = conversation.name || `Chat ${index + 1}`;
        return <button
          type="button"
          className={`conversation-link ${conversation.id === activeId ? 'active' : ''} ${waiting ? 'waiting' : ''}`}
          key={conversation.id}
          aria-label={`${title}${waiting ? ', waiting for answer' : ''}`}
          onClick={() => onSelect(conversation.id)}
        >
          <span className="conversation-title">{title}{waiting && <span className="attention-dot" aria-hidden="true" />}</span>
          <small>{waiting ? 'Waiting for answer' : conversation.source === 'discord' ? 'Discord' : conversation.provider || 'Web'}</small>
        </button>;
      })}
    </nav>
  </aside>;
}
