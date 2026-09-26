import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet } from './components/Sheet';
import { Icon } from './components/Icons';

export type RecurringDeleteScope = 'current' | 'future' | 'past' | 'all';

interface Request {
  message: string;
  title?: string;
  /** Wording for the button that goes ahead. "Delete" beats "OK" every time. */
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface RecurringDeleteRequest {
  title: string;
  typeId?: string;
  occurrence?: string;
  resolve: (scope: RecurringDeleteScope | null) => void;
}

let open: ((req: Request) => void) | null = null;
let openRecurring: ((req: RecurringDeleteRequest) => void) | null = null;

export function ask(
  message: string,
  opts: { title?: string; confirmLabel?: string; danger?: boolean } = {}
): Promise<boolean> {
  // No host mounted — which means something is asking before the app has
  // rendered. Falling back keeps the guard rather than silently deleting.
  if (!open) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => open!({ ...opts, message, resolve }));
}

export function askDeleteRecurring(opts: {
  title: string;
  typeId?: string;
  occurrence?: string;
}): Promise<RecurringDeleteScope | null> {
  if (!openRecurring) return Promise.resolve('all');
  return new Promise((resolve) => openRecurring!({ ...opts, resolve }));
}

/** Mounted once, at the top of the app. */
export function ConfirmHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [recReq, setRecReq] = useState<RecurringDeleteRequest | null>(null);
  const reqRef = useRef<Request | null>(null);
  const recReqRef = useRef<RecurringDeleteRequest | null>(null);

  reqRef.current = req;
  recReqRef.current = recReq;

  useEffect(() => {
    open = (r) => {
      reqRef.current = r;
      setReq(r);
    };
    openRecurring = (r) => {
      recReqRef.current = r;
      setRecReq(r);
    };
    return () => {
      open = null;
      openRecurring = null;
    };
  }, []);

  // Dismissing by any other means — backdrop, Escape, dragging it away — has to
  // answer the promise too, or the caller waits forever.
  const answer = useCallback((ok: boolean) => {
    const active = reqRef.current;
    reqRef.current = null;
    setReq(null);
    active?.resolve(ok);
  }, []);

  const answerRecurring = useCallback((scope: RecurringDeleteScope | null) => {
    const active = recReqRef.current;
    recReqRef.current = null;
    setRecReq(null);
    active?.resolve(scope);
  }, []);

  const isEvent = recReq?.typeId === 'event';
  const isTask = recReq?.typeId === 'task';
  const kind = isEvent ? 'event' : isTask ? 'task' : 'item';
  const recTitle = `Delete recurring ${kind}`;
  const recMsg = `“${recReq?.title || 'Untitled'}” is a repeating ${kind}. Which ${kind}s would you like to delete?`;

  const occDate = recReq?.occurrence ? new Date(recReq.occurrence + 'T12:00:00') : null;
  const occFmt = occDate && !isNaN(occDate.getTime())
    ? occDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : recReq?.occurrence;

  return (
    <>
      <Sheet open={!!req} onClose={() => answer(false)} title={req?.title ?? 'Are you sure?'}>
        <p className="confirm-text">{req?.message}</p>
        <div className="confirm-actions">
          <button className="btn subtle" onClick={() => answer(false)}>
            Cancel
          </button>
          <button className={'btn ' + (req?.danger === false ? 'primary' : 'danger')} onClick={() => answer(true)} autoFocus>
            {req?.confirmLabel ?? 'Delete'}
          </button>
        </div>
      </Sheet>

      <Sheet open={!!recReq} onClose={() => answerRecurring(null)} title={recTitle}>
        <p className="confirm-text">{recMsg}</p>
        <div className="recurring-delete-list">
          <button
            type="button"
            className="recurring-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              answerRecurring('current');
            }}
          >
            <div className="recurring-delete-icon">
              <Icon name="calendar-clock" size={16} />
            </div>
            <div className="recurring-delete-text">
              <span className="recurring-delete-title">
                {isEvent ? 'Only this event' : isTask ? 'Only this task' : 'Only this occurrence'}
              </span>
              <span className="recurring-delete-desc">
                {occFmt ? `Delete only the occurrence on ${occFmt}` : 'Delete only this single occurrence'}
              </span>
            </div>
          </button>

          <button
            type="button"
            className="recurring-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              answerRecurring('future');
            }}
          >
            <div className="recurring-delete-icon">
              <Icon name="arrow-right" size={16} />
            </div>
            <div className="recurring-delete-text">
              <span className="recurring-delete-title">
                {isEvent ? 'This and all future events' : isTask ? 'This and all future tasks' : 'This and all future occurrences'}
              </span>
              <span className="recurring-delete-desc">
                {occFmt ? `Delete on ${occFmt} and all subsequent ones` : 'Delete this and all subsequent occurrences'}
              </span>
            </div>
          </button>

          <button
            type="button"
            className="recurring-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              answerRecurring('past');
            }}
          >
            <div className="recurring-delete-icon">
              <Icon name="history" size={16} />
            </div>
            <div className="recurring-delete-text">
              <span className="recurring-delete-title">
                {isEvent ? 'This and all past events' : isTask ? 'This and all past tasks' : 'This and all past occurrences'}
              </span>
              <span className="recurring-delete-desc">
                {occFmt ? `Delete on ${occFmt} and all earlier ones` : 'Delete this and all earlier occurrences'}
              </span>
            </div>
          </button>

          <button
            type="button"
            className="recurring-delete-btn danger"
            onClick={(e) => {
              e.stopPropagation();
              answerRecurring('all');
            }}
          >
            <div className="recurring-delete-icon">
              <Icon name="trash" size={16} />
            </div>
            <div className="recurring-delete-text">
              <span className="recurring-delete-title">
                {isEvent ? 'All events' : isTask ? 'All tasks' : 'All occurrences'}
              </span>
              <span className="recurring-delete-desc">
                Delete every occurrence in this series
              </span>
            </div>
          </button>
        </div>

        <div className="confirm-actions">
          <button
            className="btn subtle"
            onClick={(e) => {
              e.stopPropagation();
              answerRecurring(null);
            }}
          >
            Cancel
          </button>
        </div>
      </Sheet>
    </>
  );
}
