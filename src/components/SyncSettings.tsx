import { useEffect, useState } from 'react';
import { api } from '../api';
import type { SyncConfig, SyncStatus } from '../types';
import { Icon } from './Icons';

/**
 * Signing in, and watching the queue drain.
 *
 * There is no switch to turn syncing on, because there is nothing to turn on:
 * the vault on this machine is the one that works, and it works the same
 * whether or not anything reaches the cloud. Signing in is the whole setting.
 *
 * The project fields are folded — they are filled in already, and the only
 * person who needs them is one moving to their own Supabase project.
 */
const WHEN = (at: number | null) => {
  if (!at) return 'not yet';
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
};

export function SyncSettings() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [cfg, setCfg] = useState<SyncConfig | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.sync.status().then(setStatus);
    api.sync.config().then(setCfg);
    return api.sync.onState(setStatus);
  }, []);

  if (!status || !cfg) return null;

  const signIn = async () => {
    setBusy(true);
    try {
      setStatus(await api.sync.signIn(email.trim(), password));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const saveProject = (patch: Partial<SyncConfig>) => {
    setCfg({ ...cfg, ...patch });
    api.sync.saveConfig(patch);
  };

  return (
    <>
      <div className="set-item">
        <div>
          <div className="set-name">Account</div>
          <div className="set-note">
            {status.account ? status.account.email : 'Sign in to keep this vault on your other devices.'}
          </div>
        </div>
        <div className="set-ctl">
          {status.account ? (
            <button className="btn subtle" onClick={() => api.sync.signOut().then(setStatus)}>
              Sign out
            </button>
          ) : null}
        </div>
      </div>

      {!status.account && (
        <div className="set-item stack">
          <input
            className="field"
            type="email"
            placeholder="you@example.com"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="field"
            type="password"
            placeholder="Password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && signIn()}
          />
          <div className="set-ctl">
            <button className="btn primary" disabled={busy || !email.trim() || !password} onClick={signIn}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </div>
      )}

      <div className="set-item">
        <div>
          <div className="set-name">Status</div>
          <div className="set-note">
            {status.error
              ? status.error
              : status.status === 'syncing'
                ? 'Syncing…'
                : `Last synced ${WHEN(status.at)}` +
                  (status.pending ? ` · ${status.pending} waiting to upload` : '')}
          </div>
        </div>
        <div className="set-ctl">
          {status.status === 'idle' && !status.error && !status.pending && (
            <span className="set-val">
              <Icon name="check" size={13} />
            </span>
          )}
          <button
            className="btn subtle"
            disabled={status.status === 'syncing' || !status.account}
            onClick={() => api.sync.now().then(setStatus)}
          >
            {status.status === 'syncing' ? 'Working…' : 'Sync now'}
          </button>
        </div>
      </div>

      <details className="set-fold">
        <summary>Supabase project</summary>
        <div className="set-fold-body">
          <div className="set-item stack">
            <input
              className="field mono"
              value={cfg.url}
              spellCheck={false}
              onChange={(e) => saveProject({ url: e.target.value })}
            />
            <input
              className="field mono"
              value={cfg.key}
              spellCheck={false}
              onChange={(e) => saveProject({ key: e.target.value })}
            />
            <div className="set-note">
              The publishable key is meant to be public — what keeps the data yours is row-level security on the
              project, not this key.
            </div>
          </div>
        </div>
      </details>
    </>
  );
}
