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
  dev: 'Development build',
};

/**
 * One row inside General's first group — version, state, and a way to install
 * without waiting for the next quit.
 */
export function UpdateSettings() {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    api.updates.state().then(setState);
    return api.updates.onState(setState);
  }, []);

  if (!state) return null;
  const busy = state.status === 'checking' || state.status === 'downloading' || state.status === 'installing';
  const next = state.next && state.next !== state.version ? ` → ${state.next}` : '';

  return (
    <div className="set-item">
      <div>
        <div className="set-name">Updates</div>
        <div className="set-note">
          {state.error || `${state.version}${next} · ${LABEL[state.status]}`}
        </div>
      </div>
      <div className="set-ctl">
        {state.status === 'current' && <span className="set-val"><Icon name="check" size={13} /></span>}
        <button className="btn subtle" disabled={busy || state.status === 'dev'} onClick={() => api.updates.check()}>
          {busy ? 'Working…' : 'Check'}
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
    </div>
  );
}
