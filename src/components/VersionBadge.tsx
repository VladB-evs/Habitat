import { useEffect, useState } from 'react';
import { api } from '../api';
import type { UpdateState } from '../types';
import { Icon } from './Icons';

/**
 * The version in the sidebar's corner, and the quickest way to act on an update.
 *
 * It says what you are actually running rather than a number typed into the
 * markup, which is the whole point: when something behaves oddly the first
 * question is which build it is. The rest is the updater's existing states
 * wearing a smaller coat — the same check, download and install that Settings
 * offers, in the one place the version is already being read.
 */
const BUSY: Partial<Record<UpdateState['status'], string>> = {
  checking: 'Checking…',
  downloading: 'Downloading…',
  installing: 'Installing…',
};

export function VersionBadge() {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    api.updates.state().then(setState);
    // The main process checks on launch and every four hours, and pushes here.
    return api.updates.onState(setState);
  }, []);

  // Nothing at all until the first answer, rather than a number that then changes.
  if (!state) return null;

  const busy = BUSY[state.status];
  if (busy) return <span className="version">{busy}</span>;

  // `staged` can be installed in place; `available` elsewhere opens the release
  // page. Both are the same gesture to the user, and `install` already knows.
  if ((state.status === 'staged' || state.status === 'available') && state.next) {
    return (
      <button
        className="version version-update"
        onClick={() => api.updates.install()}
        title={state.status === 'staged' ? `Restart into ${state.next}` : `Habitat ${state.next} is out`}
      >
        <Icon name="zap" size={11} /> Update to {state.next}
      </button>
    );
  }

  // Running from source there is no release to compare against, so the number
  // is just a label.
  if (state.status === 'dev') return <span className="version">Habitat {state.version} · dev</span>;

  return (
    <button
      className="version"
      onClick={() => api.updates.check()}
      title={state.error ? `${state.error} — click to try again` : 'Check for updates'}
    >
      Habitat {state.version}
    </button>
  );
}
