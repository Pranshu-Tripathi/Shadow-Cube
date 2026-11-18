import { useState } from 'react';
import type { Question } from '../types';

export function QuestionCard({ questions, onSubmit }: { questions: Question[]; onSubmit: (answers: Record<string, string | string[]>) => Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const complete = questions.every((question) => answers[question.question] != null);
  const choose = (question: Question, label: string) => {
    if (!question.multiSelect) return setAnswers((current) => ({ ...current, [question.question]: label }));
    setAnswers((current) => {
      const selected = new Set(Array.isArray(current[question.question]) ? current[question.question] as string[] : []);
      selected.has(label) ? selected.delete(label) : selected.add(label);
      const next = { ...current };
      if (selected.size) next[question.question] = [...selected]; else delete next[question.question];
      return next;
    });
  };
  return <section className="interaction-card question-card">
    <div className="eyebrow">Agent needs your input</div>
    {questions.map((question) => <fieldset key={question.question}>
      {question.header && <legend>{question.header}</legend>}
      <p>{question.question}</p>
      <div className="choice-grid">
        {question.options.map((option) => {
          const selected = Array.isArray(answers[question.question])
            ? (answers[question.question] as string[]).includes(option.label)
            : answers[question.question] === option.label;
          return <button type="button" className={selected ? 'choice selected' : 'choice'} key={option.label} onClick={() => choose(question, option.label)}>
            <strong>{option.label}</strong>{option.description && <span>{option.description}</span>}
          </button>;
        })}
      </div>
      <div className="custom-answer"><input placeholder="Or enter a custom answer" value={custom[question.question] || ''} onChange={(event) => setCustom((value) => ({ ...value, [question.question]: event.target.value }))} /><button onClick={() => {
        const value = custom[question.question]?.trim();
        if (value) setAnswers((current) => ({ ...current, [question.question]: question.multiSelect ? [value] : value }));
      }}>Use</button></div>
    </fieldset>)}
    <div className="card-actions"><button className="primary" disabled={!complete || busy} onClick={async () => { setBusy(true); try { await onSubmit(answers); } finally { setBusy(false); } }}>{busy ? 'Sending…' : 'Submit answer'}</button></div>
  </section>;
}
