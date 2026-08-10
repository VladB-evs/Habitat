import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { dialogIn, snap } from '../motion';
import { useApp } from '../store';
import type { AiAnswer, AiSource } from '../types';
import { typeColor } from '../util';
import { Icon, TypeIcon } from './Icons';

/**
 * Questions worth showing someone who has never asked one. They exist to teach
 * the two shapes the feature actually handles — a day, or a subject — rather
 * than to suggest it can answer anything.
 */
const EXAMPLES = [
  'Summarise my daily note from two days ago',
  'What did I do last Thursday?',
  'Do I have any pages about the lease?',
];

/**
 * Ask a question, get an answer built from your own notes.
 *
 * Which notes get read is decided in the main process, in code — a day is
 * resolved by arithmetic, a subject by the search index — and the model only
 * ever sees text it was handed. The sources are listed under every answer
 * because an answer from a model this small is worth having only if you can
 * check it, and one click does.
 */
export function AskPanel({ onClose }: { onClose: () => void }) {
  const { types, openObject, theme } = useApp();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<AiSource[]>([]);
  const [dates, setDates] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const runIdRef = useRef('');

  useEffect(() => api.ai.onDelta((msg) => msg.id === runIdRef.current && setAnswer(msg.text)), []);

  // A question in flight outlives this panel as a process — stop it on the way out.
  useEffect(() => () => void (runIdRef.current && api.ai.cancel(runIdRef.current)), []);

  const submit = async (text: string) => {
    const asked = text.trim();
    if (!asked || busy) return;
    const id = crypto.randomUUID();
    runIdRef.current = id;
    setQuestion(asked);
    setAnswer('');
    setSources([]);
    setDates(null);
    setError('');
    setBusy(true);

    const res: AiAnswer = await api.ai.ask({ id, question: asked });
    // A later question, or a cancel, has taken over — this answer is stale.
    if (runIdRef.current !== id) return;
    setBusy(false);
    if (res.ok) {
      setAnswer(res.text ?? '');
      setSources(res.sources ?? []);
      setDates(res.dates?.label ?? null);
    } else {
      setError(res.error || "That didn't work.");
      setDates(res.dates?.label ?? null);
    }
  };

  const stop = () => {
    if (runIdRef.current) api.ai.cancel(runIdRef.current);
    runIdRef.current = '';
    setBusy(false);
  };

  const open = (source: AiSource) => {
    onClose();
    openObject(source.id);
  };

  const asked = !!(answer || error || busy);

  return (
    <motion.div
      className="palette-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={snap}
    >
      <motion.div className="palette ask" variants={dialogIn} initial="hidden" animate="shown">
        <div className="ask-bar">
          <Icon name="sparkles" size={15} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Ask about your notes…"
            defaultValue={question}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') return busy ? stop() : onClose();
              if (e.key === 'Enter') submit((e.target as HTMLInputElement).value);
            }}
          />
          {busy && (
            <button className="ask-stop" onClick={stop}>
              Stop
            </button>
          )}
        </div>

        <div className="ask-body">
          {!asked && (
            <div className="ask-examples">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  className="ask-example"
                  onClick={() => {
                    if (inputRef.current) inputRef.current.value = example;
                    submit(example);
                  }}
                >
                  {example}
                </button>
              ))}
            </div>
          )}

          {dates && <div className="ask-scope">Reading {dates}</div>}

          {error && <p className="ask-error">{error}</p>}

          {(answer || busy) && !error && (
            // `aria-live` so the answer is read out as it arrives, not only once
            // the sources appear underneath it.
            <div className="ask-answer" aria-live="polite">
              {answer || <span className="ask-wait">Reading your notes…</span>}
            </div>
          )}

          {!busy && sources.length > 0 && (
            <div className="ask-sources">
              <span className="ask-sources-label">From</span>
              {sources.map((source) => {
                const type = types.find((t) => t.id === source.typeId);
                return (
                  <button key={source.id} className="ask-source" onClick={() => open(source)}>
                    <TypeIcon icon={type?.icon} color={typeColor(type?.color, theme)} size={13} />
                    <span>{source.title || 'Untitled'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="palette-hint">
          <span>↵ ask</span>
          <span>esc close</span>
          <span className="ask-note">Answered on this Mac, from your notes only</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
