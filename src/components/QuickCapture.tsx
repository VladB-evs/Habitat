import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { fmtWhen, parseWhen, toValue, When } from '../dateParse';
import { addDays, keyOf, todayKey } from '../util';
import { Icon } from './Icons';
import { Sheet } from './Sheet';

type CaptureMode = 'task' | 'daily' | 'note';

interface QuickCaptureProps {
  open: boolean;
  onClose: () => void;
  onCaptured?: (info: { mode: CaptureMode; title: string }) => void;
}

const ACTION_VERBS = /^(buy|call|send|fix|read|write|check|email|schedule|remember|todo|clean|pay|finish|update|order|meet|pick up|book|review|submit|file|post|cancel|reply|renew)\b/i;

const DATE_REGEXES = [
  /\b(today|tonight|tomorrow|tmrw|yesterday)\b(\s+(at\s+)?\d{1,2}(:\d{2})?\s*(am|pm)?)?/i,
  /\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b(\s+(at\s+)?\d{1,2}(:\d{2})?\s*(am|pm)?)?/i,
  /\b(at\s+\d{1,2}(:\d{2})?\s*(am|pm)?)\b/i,
  /\bin\s+\d+\s*(d|day|days|h|hr|hours|w|week|weeks)\b/i,
];

export function QuickCapture({ open, onClose, onCaptured }: QuickCaptureProps) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<CaptureMode>('task');
  const [manualMode, setManualMode] = useState(false);
  const [customWhen, setCustomWhen] = useState<When | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus on open
  useEffect(() => {
    if (open) {
      setText('');
      setManualMode(false);
      setCustomWhen(null);
      setSubmitting(false);
      setFeedback(null);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  // Natural language inference
  let detectedWhen: When | null = customWhen;
  let cleanedTitle = text.trim();

  if (!customWhen) {
    for (const re of DATE_REGEXES) {
      const m = text.match(re);
      if (m) {
        const parsed = parseWhen(m[0]);
        if (parsed) {
          detectedWhen = parsed;
          cleanedTitle = text
            .replace(m[0], '')
            .replace(/\s+at\s*$/i, '')
            .replace(/\s+on\s*$/i, '')
            .trim();
          break;
        }
      }
    }
  }

  // Auto-infer mode if user hasn't explicitly picked one
  useEffect(() => {
    if (manualMode || !text.trim()) return;

    const trimmed = text.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      setMode('daily');
    } else if (trimmed.includes('\n') && !ACTION_VERBS.test(trimmed)) {
      setMode('note');
    } else if (detectedWhen || ACTION_VERBS.test(trimmed)) {
      setMode('task');
    }
  }, [text, manualMode, detectedWhen]);

  const selectMode = (m: CaptureMode) => {
    setMode(m);
    setManualMode(true);
  };

  const handleQuickDate = (daysAhead: number) => {
    const targetKey = addDays(todayKey(), daysAhead);
    setCustomWhen({ key: targetKey, minutes: null });
    setMode('task');
    setManualMode(true);
  };

  const handleSubmit = async () => {
    const raw = text.trim();
    if (!raw || submitting) return;

    setSubmitting(true);
    try {
      if (mode === 'task') {
        const titleToUse = cleanedTitle || raw;
        const dueVal = detectedWhen ? toValue(detectedWhen.key, detectedWhen.minutes) : null;
        const props: Record<string, any> = {};
        if (dueVal) props.due = dueVal;

        await api.objects.create({
          typeId: 'task',
          title: titleToUse,
          props,
        });
        setFeedback('Saved to Tasks');
      } else if (mode === 'daily') {
        await api.daily.append(raw);
        setFeedback("Appended to Today's Note");
      } else {
        const lines = raw.split('\n');
        const title = lines[0].slice(0, 80);
        const doc = lines.length > 1
          ? {
              type: 'doc',
              content: lines.slice(1).map((l) => ({
                type: 'paragraph',
                content: l ? [{ type: 'text', text: l }] : [],
              })),
            }
          : null;

        await api.objects.create({
          typeId: 'note',
          title,
          content: doc,
        });
        setFeedback('Saved to Notes');
      }

      onCaptured?.({ mode, title: cleanedTitle || raw });

      // Trigger background sync if possible
      api.sync.now().catch(() => {});

      setTimeout(() => {
        onClose();
      }, 350);
    } catch (err: any) {
      console.error('[quick-capture] Failed:', err);
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Quick Capture">
      <div className="qc-sheet">
        {/* Mode selector pills */}
        <div className="qc-modes" role="tablist">
          <button
            type="button"
            className={'qc-mode-pill' + (mode === 'task' ? ' active' : '')}
            onClick={() => selectMode('task')}
          >
            <Icon name="circle-check" size={15} />
            <span>Task</span>
          </button>
          <button
            type="button"
            className={'qc-mode-pill' + (mode === 'daily' ? ' active' : '')}
            onClick={() => selectMode('daily')}
          >
            <Icon name="calendar" size={15} />
            <span>Daily Note</span>
          </button>
          <button
            type="button"
            className={'qc-mode-pill' + (mode === 'note' ? ' active' : '')}
            onClick={() => selectMode('note')}
          >
            <Icon name="file-text" size={15} />
            <span>Note</span>
          </button>
        </div>

        {/* Input box */}
        <div className="qc-input-wrap">
          <textarea
            ref={inputRef}
            className="qc-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              mode === 'task'
                ? "Capture a task... (e.g. 'Call doctor tomorrow at 3pm')"
                : mode === 'daily'
                  ? "Write to today's daily log..."
                  : 'Capture an idea or note...'
            }
            rows={3}
            disabled={submitting}
          />
        </div>

        {/* Task date indicators and shortcuts */}
        {mode === 'task' && (
          <div className="qc-date-row">
            {detectedWhen ? (
              <div className="qc-detected-date">
                <Icon name="clock" size={13} />
                <span>Due: {fmtWhen(detectedWhen.key, detectedWhen.minutes)}</span>
                <button
                  type="button"
                  className="qc-date-clear"
                  onClick={() => setCustomWhen(null)}
                  title="Clear date"
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ) : (
              <div className="qc-quick-dates">
                <button type="button" className="qc-chip" onClick={() => handleQuickDate(0)}>
                  Today
                </button>
                <button type="button" className="qc-chip" onClick={() => handleQuickDate(1)}>
                  Tomorrow
                </button>
                <button type="button" className="qc-chip" onClick={() => handleQuickDate(7)}>
                  Next Week
                </button>
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="qc-footer">
          <div className="qc-tip">
            {feedback ? (
              <span className="qc-feedback">
                <Icon name="check" size={14} /> {feedback}
              </span>
            ) : (
              <span>Zero syntax • LAN auto-sync</span>
            )}
          </div>
          <button
            type="button"
            className="btn btn-primary qc-submit-btn"
            disabled={!text.trim() || submitting}
            onClick={handleSubmit}
          >
            {submitting ? 'Saving…' : 'Capture'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export default QuickCapture;
