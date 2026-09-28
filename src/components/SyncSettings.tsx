import { useEffect, useState } from 'react';
import { api } from '../api';
import { isStandalone } from '../vault/client';
import type { HttpApiConfig, SyncStatus } from '../types';
import { Icon } from './Icons';

const WHEN = (at: number | null) => {
  if (!at) return 'never';
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
};

export function SyncSettings() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [macUrl, setMacUrl] = useState('');
  const [macToken, setMacToken] = useState('');
  const [cloning, setCloning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [cloneMsg, setCloneMsg] = useState<string | null>(null);

  // Desktop server info
  const [serverStatus, setServerStatus] = useState<{ running: boolean; port: number; url?: string } | null>(null);
  const [serverCfg, setServerCfg] = useState<HttpApiConfig | null>(null);

  const standalone = isStandalone();

  useEffect(() => {
    api.sync.status().then(setStatus);
    const un = api.sync.onState(setStatus);

    if (standalone) {
      api.sync.getLanConfig().then((cfg) => {
        if (cfg?.baseUrl) setMacUrl(cfg.baseUrl);
        if (cfg?.token) setMacToken(cfg.token);
      }).catch(() => {});
    } else {
      api.http.status().then(setServerStatus).catch(() => {});
      api.http.config().then(setServerCfg).catch(() => {});
    }

    return un;
  }, [standalone]);

  const handleClone = async () => {
    if (!macUrl.trim() || cloning) return;
    setCloning(true);
    setCloneMsg(null);
    try {
      let url = macUrl.trim();
      if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
      const res = await api.sync.cloneFromMac({ baseUrl: url, token: macToken.trim() });
      if (res?.cloned) {
        setCloneMsg(`Vault successfully cloned (seq: ${res.snapshotSeq})!`);
        api.sync.status().then(setStatus);
      }
    } catch (err: any) {
      setCloneMsg(`Clone error: ${err?.message || err}`);
    } finally {
      setCloning(false);
    }
  };

  const handleSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await api.sync.now();
      setStatus(res);
    } catch (err: any) {
      console.warn('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  const handleEnableServer = async () => {
    if (!serverCfg) return;
    const next = { ...serverCfg, enabled: true, lan: true };
    await api.http.save(next);
    await api.http.apply();
    api.http.status().then(setServerStatus);
    api.http.config().then(setServerCfg);
  };

  return (
    <>
      <div className="set-item">
        <div>
          <div className="set-name">Local Wi-Fi Peer Sync</div>
          <div className="set-note">
            Direct peer-to-peer sync over your local network. No cloud accounts, external databases, or third-party servers.
          </div>
        </div>
      </div>

      {/* Standalone Mobile View: Connect to Mac & Clone / Delta Sync */}
      {standalone ? (
        <>
          <div className="set-item stack">
            <div className="set-name">Connect to Mac</div>
            <div className="set-note">
              Enter your Mac's LAN address shown in its Habitat Settings → Sync:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <input
                type="text"
                className="input"
                placeholder="http://192.168.1.X:37381"
                value={macUrl}
                onChange={(e) => setMacUrl(e.target.value)}
              />
              <input
                type="password"
                className="input"
                placeholder="Token (from Mac settings, if required)"
                value={macToken}
                onChange={(e) => setMacToken(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!macUrl.trim() || cloning}
                  onClick={handleClone}
                >
                  {cloning ? 'Cloning…' : 'Clone Vault from Mac'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={syncing}
                  onClick={handleSyncNow}
                >
                  {syncing ? 'Syncing…' : 'Sync Now'}
                </button>
              </div>
              {cloneMsg && (
                <div style={{ fontSize: 13, color: cloneMsg.includes('error') ? '#ef4444' : '#10b981', marginTop: 4 }}>
                  {cloneMsg}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Desktop View: Show Mac's LAN Address & Status for the Phone */
        <>
          <div className="set-item">
            <div>
              <div className="set-name">Mac LAN Address (for your phone)</div>
              <div className="set-note">
                {serverStatus?.running ? (
                  <code style={{ background: 'var(--bg-2)', padding: '2px 6px', borderRadius: 4 }}>
                    {serverStatus.url || `http://${(serverStatus as any).lanAddress || '127.0.0.1'}:${serverStatus.port}`}
                  </code>
                ) : (
                  'Server not running. Enable Local API to allow mobile connection.'
                )}
              </div>
            </div>
            <div className="set-ctl">
              {!serverStatus?.running && (
                <button type="button" className="btn btn-primary" onClick={handleEnableServer}>
                  Enable Sync Server
                </button>
              )}
            </div>
          </div>

          {serverCfg?.token && (
            <div className="set-item">
              <div>
                <div className="set-name">Bearer Token</div>
                <div className="set-note">
                  <code style={{ background: 'var(--bg-2)', padding: '2px 6px', borderRadius: 4 }}>
                    {serverCfg.token}
                  </code>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Sync status row */}
      {status && (
        <div className="set-item">
          <div>
            <div className="set-name">Sync Status</div>
            <div className="set-note">
              {status.error
                ? `Error: ${status.error}`
                : status.status === 'syncing'
                  ? 'Syncing changes over Wi-Fi…'
                  : `Last synced: ${WHEN(status.at)}` +
                    (status.pending ? ` · ${status.pending} local changes ready to push` : ' · Fully up to date')}
            </div>
          </div>
          <div className="set-ctl">
            {status.status === 'idle' && !status.error && (
              <span className="set-val" style={{ color: '#10b981' }}>
                <Icon name="check" size={15} />
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default SyncSettings;
