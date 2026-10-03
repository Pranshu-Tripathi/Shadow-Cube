import type { Conversation, Workspace } from '../types';

export function ConversationSidebar({ workspace, conversations, activeId, onSelect, onNew }: {
  workspace: Workspace | null;
  conversations: Conversation[];
  activeId: string | null;
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
      {conversations.map((conversation, index) => <button
        type="button"
        className={`conversation-link ${conversation.id === activeId ? 'active' : ''}`}
        key={conversation.id}
        onClick={() => onSelect(conversation.id)}
      >
        <span>{conversation.name || `Chat ${index + 1}`}</span>
        <small>{conversation.source === 'discord' ? 'Discord' : conversation.provider || 'Web'}</small>
      </button>)}
    </nav>
  </aside>;
}
