import { useEffect, useState } from 'react';
import { api } from '../api';
import type { UpdateState } from '../types';
import { Icon } from './Icons';

const LABEL: Record<UpdateState['status'], string> = {
  idle: 'Not checked yet',
  checking: 'Checking…',
  current: 'Up to date',
  available: 'New version available',
  downloading: 'Downloading…',
  staged: 'Ready to install',
  installing: 'Installing…',
  error: 'Could not check',
  dev: 'Development build — updates are off',
};

/** Update status, plus a way to install one without waiting for the next quit. */
export function UpdateSettings() {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    api.updates.state().then(setState);
    return api.updates.onState(setState);
  }, []);

  if (!state) return null;
  const busy = state.status === 'checking' || state.status === 'downloading' || state.status === 'installing';

  return (
    <div className="settings-row col">
      <div>
        <div className="s-label">Updates</div>
        <div className="s-hint">
          Habitat checks GitHub for new releases on launch and every few hours and downloads them in the background.
          Because the builds aren't code-signed, it replaces its own app bundle rather than going through macOS's
          updater — press Restart &amp; install when one is ready.
        </div>
      </div>

      <div className="tg-row">
        <span className="s-sub">Version</span>
        <span className="tg-state">
          {state.version}
          {state.next && state.next !== state.version ? ` → ${state.next}` : ''}
        </span>
      </div>

      <div className="tg-row">
        <span className="s-sub">Status</span>
        <span className="tg-state">
          {state.status === 'current' && <Icon name="check" size={13} />}
          {LABEL[state.status]}

        </span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" disabled={busy || state.status === 'dev'} onClick={() => api.updates.check()}>
          {busy ? 'Working…' : 'Check now'}
        </button>
        {state.status === 'staged' && (
          <button className="btn primary" onClick={() => api.updates.install()}>
            <Icon name="zap" size={13} /> Restart &amp; install
          </button>
        )}
        {state.status === 'available' && state.url && (
          <button className="btn primary" onClick={() => api.updates.install()}>
            <Icon name="arrow-up-right" size={13} /> Open release
          </button>
        )}
      </div>

      {state.error && <div className="s-notice">{state.error}</div>}
    </div>
  );
}
