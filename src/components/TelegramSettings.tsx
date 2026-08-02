import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { TelegramConfig } from '../types';
import { Icon } from './Icons';

/**
 * Capture from your phone and get messaged back. Everything goes through your
 * own bot — the token lives in the vault, and nothing is sent anywhere else.
 *
 * The setup steps and routing rules are folded rather than deleted: without
 * them the feature can't be set up at all until the online guide exists.
 */
export function TelegramSettings() {
  const { types } = useApp();
  const [cfg, setCfg] = useState<TelegramConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const pickable = types.filter((t) => t.id !== 'daily' && t.id !== 'tag');

  useEffect(() => {
    api.telegram.get().then(setCfg);
  }, []);

  if (!cfg) return null;

  const save = (patch: Partial<TelegramConfig>) => {
    setCfg({ ...cfg, ...patch });
    api.telegram.save(patch);
  };

  const test = async () => {
    setBusy(true);
    setResult('');
    try {
      const r = await api.telegram.test();
      setResult(r.ok ? `Connected to @${r.bot} — check your phone.` : r.error || 'Could not connect.');
      api.telegram.get().then(setCfg);
    } finally {
      setBusy(false);
    }
  };

  const collect = async () => {
    setBusy(true);
    setResult('');
    try {
      await api.telegram.poll();
      const fresh = await api.telegram.get();
      setCfg(fresh);
      setResult(
        fresh.chatId
          ? fresh.userName
            ? `Paired with @${fresh.userName}.`
            : 'Paired.'
          : 'Not paired yet — send the code to your bot, then check again.'
      );
    } finally {
      setBusy(false);
    }
  };

  const startPairing = async () => {
    setBusy(true);
    setResult('');
    try {
      setCfg(await api.telegram.pair());
    } finally {
      setBusy(false);
    }
  };

  const unpair = async () => {
    if (!confirm('Unpair this chat? Nothing will be accepted until you pair again.')) return;
    setCfg(await api.telegram.unpair());
    setResult('Unpaired.');
  };

  const codeLive = !!cfg.pairCode && (!cfg.pairExpires || Date.now() < cfg.pairExpires);

  return (
    <section className="set-sec">
      <div className="set-title">Telegram</div>
      <div className="set-group">
        <div className="set-item">
          <div>
            <div className="set-name">Capture</div>
            <div className="set-note">Message your own bot from anywhere and it lands here.</div>
          </div>
          <button
            className={'toggle' + (cfg.enabled ? ' on' : '')}
            onClick={() => save({ enabled: !cfg.enabled })}
            aria-label={cfg.enabled ? 'Disable Telegram' : 'Enable Telegram'}
          >
            <span className="knob" />
          </button>
        </div>

        <div className="set-item">
          <div>
            <div className="set-name">Bot token</div>
            <div className="set-note">Stored in your vault — treat it like a password.</div>
          </div>
          <div className="set-ctl">
            <input
              className="field"
              type="password"
              style={{ width: 190 }}
              placeholder="123456:ABC-DEF…"
              value={cfg.token}
              onChange={(e) => save({ token: e.target.value.trim() })}
            />
            <button className="btn subtle" disabled={busy || !cfg.token} onClick={test}>
              {busy ? 'Working…' : 'Test'}
            </button>
          </div>
        </div>

        <div className="set-item">
          <div className="set-name">Fallback type</div>
          <select className="field" style={{ width: 160 }} value={cfg.typeId || 'note'} onChange={(e) => save({ typeId: e.target.value })}>
            {pickable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="set-item">
          <div className="set-name">Paired with</div>
          <div className="set-ctl">
            <span className="set-val">
              {cfg.chatId ? (
                <>
                  <Icon name="check" size={13} />
                  {cfg.userName ? `@${cfg.userName}` : 'your chat'}
                  {cfg.botName ? ` on @${cfg.botName}` : ''}
                </>
              ) : codeLive ? (
                'waiting for the code…'
              ) : (
                'nobody yet'
              )}
            </span>
            {!cfg.chatId && (
              <button className="btn" disabled={busy || !cfg.token} onClick={startPairing}>
                {codeLive ? 'New code' : 'Pair'}
              </button>
            )}
            <button className="btn subtle" disabled={busy || !cfg.token} onClick={collect}>
              Check
            </button>
            {cfg.chatId && (
              <button className="btn subtle" onClick={unpair}>
                Unpair
              </button>
            )}
          </div>
        </div>

        {!cfg.chatId && codeLive && (
          <div className="set-item stack">
            <div className="tg-pair">
              <div className="tg-code">{cfg.pairCode}</div>
              <div className="set-note">
                Send this to {cfg.botName ? <>@{cfg.botName}</> : 'your bot'}, then press Check. Expires in 15 minutes.
              </div>
            </div>
          </div>
        )}

        <details className="set-fold">
          <summary>Set up a bot</summary>
          <div className="set-fold-body">
            <ol className="tg-steps">
              <li>
                Message <code>@BotFather</code> → <code>/newbot</code>, and copy the token.
              </li>
              <li>
                Run <code>/setjoingroups</code> for your bot and choose <b>Disable</b>.
              </li>
              <li>Paste the token above and press Test.</li>
              <li>Press Pair, then send the code to your bot.</li>
            </ol>
          </div>
        </details>

        <details className="set-fold">
          <summary>Message routing</summary>
          <div className="set-fold-body">
            <div className="set-note">
              The first word decides where it goes: <code>daily …</code> appends to today's note, a type name like{' '}
              <code>task …</code> creates one of those, anything else uses the fallback type. Checked every minute while
              Habitat is open, and only the paired account is accepted.
            </div>
          </div>
        </details>
      </div>

      {result && (
        <div className="s-notice" style={{ marginTop: 10 }}>
          {result}
        </div>
      )}
    </section>
  );
}
