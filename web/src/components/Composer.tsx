import { useRef, useState } from 'react';

function extensionFor(type: string) { return type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm'; }

export function Composer({ workspaceId, disabled, voiceEnabled, onSend }: { workspaceId: string; disabled?: boolean; voiceEnabled: boolean; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const submit = async () => {
    const prompt = text.trim();
    if (!prompt || sending) return;
    setSending(true); setText('');
    try { await onSend(prompt); } catch (error) { setText(prompt); throw error; } finally { setSending(false); }
  };
  const startVoice = async () => {
    if (!voiceEnabled || recorder.current) return;
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
      chunks.current = [];
      recorder.current = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
      recorder.current.ondataavailable = (event) => event.data.size && chunks.current.push(event.data);
      recorder.current.onstop = async () => {
        const current = recorder.current;
        const blob = new Blob(chunks.current, { type: current?.mimeType });
        stream.current?.getTracks().forEach((track) => track.stop());
        stream.current = null; recorder.current = null;
        if (blob.size < 1200) return setVoiceStatus('');
        setVoiceStatus('Transcribing…');
        try {
          const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/transcribe?ext=${extensionFor(blob.type)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: blob });
          const result = await response.json();
          if (!response.ok || result.error) throw new Error(result.error || 'Transcription failed.');
          setText((currentText) => `${currentText}${currentText ? ' ' : ''}${result.text || ''}`);
          setVoiceStatus('');
        } catch (error) { setVoiceStatus(error instanceof Error ? error.message : 'Transcription failed.'); }
      };
      recorder.current.start(); setVoiceStatus('Recording… release to transcribe');
    } catch (error) { setVoiceStatus(error instanceof Error ? error.message : 'Microphone unavailable.'); }
  };
  const stopVoice = () => { if (recorder.current?.state === 'recording') recorder.current.stop(); };
  return <div className="composer-wrap">
    {voiceStatus && <div className="voice-status">{voiceStatus}</div>}
    <div className="composer">
      <textarea value={text} disabled={disabled} placeholder="Message the agent…" rows={1} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); }
      }} />
      {voiceEnabled && <button className="icon-button mic" title="Hold to talk" onPointerDown={() => void startVoice()} onPointerUp={stopVoice} onPointerCancel={stopVoice}>◉</button>}
      <button className="send-button" disabled={!text.trim() || sending || disabled} onClick={() => void submit()}>{sending ? '…' : '↑'}</button>
    </div>
  </div>;
}
