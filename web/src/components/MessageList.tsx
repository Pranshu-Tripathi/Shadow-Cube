import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Approval, Message, Question } from '../types';
import { QuestionCard } from './QuestionCard';

function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}>{children}</ReactMarkdown>;
}

export function MessageList({ messages, questions, approval, onAnswer, onApprove }: {
  messages: Message[];
  questions?: Question[];
  approval?: Approval;
  onAnswer: (answers: Record<string, string | string[]>) => Promise<void>;
  onApprove: (decision: string) => Promise<void>;
}) {
  return <div className="transcript" aria-live="polite">
    {!messages.length && !questions && !approval && <div className="conversation-empty"><div className="empty-cube">◆</div><h2>Ready when you are</h2><p>Ask for a change, investigation, review, or implementation.</p></div>}
    {messages.map((message) => {
      if (message.kind === 'tool' || message.kind === 'thinking') return <details className={`event-block ${message.kind}`} key={message.msgId}>
        <summary>{message.title || (message.kind === 'thinking' ? 'Thinking' : 'Tool call')}</summary><div className="event-content"><Markdown>{message.content}</Markdown></div>
      </details>;
      if (message.kind === 'cost') return <div className="cost-line" key={message.msgId}>{message.content.replace(/\*/g, '')}</div>;
      return <article className={`message ${message.role === 'user' ? 'user' : 'agent'}`} key={message.msgId}>
        <div className="message-label">{message.role === 'user' ? 'You' : 'Agent'}</div><div className="message-body"><Markdown>{message.content}</Markdown></div>
      </article>;
    })}
    {questions && <QuestionCard questions={questions} onSubmit={onAnswer} />}
    {approval && <section className="interaction-card approval-card"><div className="eyebrow">Approval required</div><Markdown>{approval.content}</Markdown><div className="card-actions">{approval.options.map((option) => <button className={option.style === 'primary' ? 'primary' : ''} key={option.decision} onClick={() => onApprove(option.decision)}>{option.label}</button>)}</div></section>}
  </div>;
}
