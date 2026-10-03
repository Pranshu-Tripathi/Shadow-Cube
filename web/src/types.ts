export type Provider = 'claude' | 'codex';

export interface Project {
  id: string;
  name: string;
  path: string | null;
  configured: boolean;
  workspaceCount: number;
  bootstrapCommands: string[];
}

export interface Workspace {
  id: string;
  name: string;
  projectId: string;
  projectName: string | null;
  projectDir: string | null;
  provider: Provider;
  baseBranch: string | null;
  broadcastDiscord: boolean;
  discordChannelId: string | null;
  rulesRepo: string | null;
  rulesPath: string | null;
  hasSystemPrompt: boolean;
  isWeb: boolean;
}

export interface Conversation {
  id: string;
  name: string | null;
  source: 'web' | 'discord';
  hasMessages?: boolean;
  provider?: Provider | null;
}

export interface Message {
  msgId: string;
  role?: 'user' | 'agent';
  content: string;
  kind?: 'text' | 'thinking' | 'tool' | 'cost';
  title?: string;
}

export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description?: string; preview?: string }>;
}

export interface Approval {
  token: string;
  content: string;
  options: Array<{ label: string; decision: string; style?: string }>;
}
