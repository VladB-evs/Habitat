import { useCallback, useEffect, useState } from 'react';
import { Sheet } from './components/Sheet';

/**
 * "Are you sure?", asked in the app's own voice.
 *
 * `window.confirm` is a webview dialog: it cannot be styled, it says the app's
 * origin across the top, it ignores the safe area, and on iOS it arrives as a
 * system alert that looks like the page has done something wrong. Eighteen of
 * them across the app, every one of them in front of a delete.
 *
 * The awkward part is that `confirm` is *synchronous* and a React dialog cannot
 * be. Rather than lift state into thirteen components, the question is asked
 * through a promise and answered by one host mounted at the top of the tree —
 * so a call site changes by one `await` and nothing else:
 *
 *     if (!confirm('Delete this?')) return;            // before
 *     if (!(await ask('Delete this?'))) return;        // after
 */

interface Request {
  message: string;
  title?: string;
  /** Wording for the button that goes ahead. "Delete" beats "OK" every time. */
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

let open: ((req: Request) => void) | null = null;

export function ask(
  message: string,
  opts: { title?: string; confirmLabel?: string; danger?: boolean } = {}
): Promise<boolean> {
  // No host mounted — which means something is asking before the app has
  // rendered. Falling back keeps the guard rather than silently deleting.
  if (!open) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => open!({ ...opts, message, resolve }));
}

/** Mounted once, at the top of the app. */
export function ConfirmHost() {
  const [req, setReq] = useState<Request | null>(null);

  useEffect(() => {
    open = setReq;
    return () => {
      open = null;
    };
  }, []);

  // Dismissing by any other means — backdrop, Escape, dragging it away — has to
  // answer the promise too, or the caller waits forever.
  const answer = useCallback(
    (ok: boolean) => {
      req?.resolve(ok);
      setReq(null);
    },
    [req]
  );

  return (
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
  );
}
