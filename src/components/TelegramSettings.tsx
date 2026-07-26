import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { TelegramConfig } from '../types';
import { Icon } from './Icons';

/**
 * Capture from your phone and get messaged back. Everything goes through your
 * own bot — the token lives in the vault, and nothing is sent anywhere else.
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
      setResult(fresh.chatId ? 'Checked for new messages.' : 'No messages yet — send one to your bot first.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-row col">
      <div>
        <div className="s-label">Telegram capture</div>
        <div className="s-hint">
          Message your own bot from anywhere and it lands here; automations can message you back with the{' '}
          <b>Message me on Telegram</b> action. Habitat checks for new messages every minute while it's open.
          <br />
          The first word routes the message: <code>daily …</code> appends to today's note, a type name like{' '}
          <code>task …</code> or <code>book …</code> creates one of those, and anything else is kept whole as the
          fallback type below.
        </div>
        <ol className="tg-steps">
          <li>
            In Telegram, message <code>@BotFather</code> → <code>/newbot</code>, and copy the token it gives you.
          </li>
          <li>Paste it below and press Connect.</li>
          <li>Send your new bot any message so it learns which chat is yours.</li>
        </ol>
      </div>

      <div className="tg-row">
        <span className="s-sub">Bot token</span>
        <input
          className="field"
          type="password"
          placeholder="123456:ABC-DEF…"
          value={cfg.token}
          onChange={(e) => save({ token: e.target.value.trim() })}
        />
      </div>

      <div className="tg-row">
        <span className="s-sub">Fallback type</span>
        <select className="field" value={cfg.typeId || 'note'} onChange={(e) => save({ typeId: e.target.value })}>
          {pickable.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="tg-row">
        <span className="s-sub">Chat</span>
        <span className="tg-state">
          {cfg.chatId ? (
            <>
              <Icon name="check" size={13} /> linked{cfg.botName ? ` to @${cfg.botName}` : ''}
            </>
          ) : (
            'not linked yet — send your bot a message, then press Check now'
          )}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className={'toggle' + (cfg.enabled ? ' on' : '')}
          onClick={() => save({ enabled: !cfg.enabled })}
          aria-label={cfg.enabled ? 'Disable Telegram' : 'Enable Telegram'}
          title={cfg.enabled ? 'On' : 'Off'}
        >
          <span className="knob" />
        </button>
        <button className="btn" disabled={busy || !cfg.token} onClick={test}>
          {busy ? 'Working…' : 'Connect & test'}
        </button>
        <button className="btn subtle" disabled={busy || !cfg.token} onClick={collect}>
          Check now
        </button>
        {cfg.chatId && (
          <button className="btn subtle" onClick={() => save({ chatId: '' })}>
            Forget chat
          </button>
        )}
      </div>

      {result && <div className="s-notice">{result}</div>}
      <div className="s-hint">
        The token is stored in your vault file. Anyone with it can post as your bot, so treat it like a password — and
        revoke it in BotFather if it leaks.
      </div>
    </div>
  );
}
