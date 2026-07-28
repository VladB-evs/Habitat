import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { UserVar } from '../types';
import { clientUid } from '../util';
import { ApiSettings } from './ApiSettings';
import { UpdateSettings } from './UpdateSettings';
import { Automations } from './Automations';
import { TelegramSettings } from './TelegramSettings';
import { Icon } from './Icons';

const TABS = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'automations', label: 'Automations', icon: 'zap' },
  { id: 'capture', label: 'Capture', icon: 'message-circle' },
  { id: 'api', label: 'API', icon: 'code' },
  { id: 'import', label: 'Import', icon: 'folder' },
  { id: 'scripts', label: 'Scripts', icon: 'code' },
] as const;

type Tab = (typeof TABS)[number]['id'];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = useApp();
  const [dbPath, setDbPath] = useState('');
  const [notice, setNotice] = useState('');
  const [vars, setVars] = useState<UserVar[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const [tab, setTab] = useState<Tab>('general');
  const [code, setCode] = useState('');

  useEffect(() => {
    api.settings.get().then((s) => setDbPath(s.dbPath));
    api.vars.list().then(setVars);
    api.habitat.code().then(setCode);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveVars = (list: UserVar[]) => {
    setVars(list);
    api.vars.save(list);
  };

  const runImport = async (mode: 'vault' | 'daily') => {
    setImportResult('');
    setImporting(true);
    try {
      const r = await api.importObsidian(mode);
      if (!r) return;
      if (r.scanned === 0) {
        setImportResult('No .md files found in that folder.');
        return;
      }
      const bits = [];
      if (r.daily) bits.push(`${r.daily} daily ${r.daily === 1 ? 'note' : 'notes'}`);
      if (r.notes) bits.push(`${r.notes} ${r.notes === 1 ? 'note' : 'notes'}`);
      if (r.tags) bits.push(`${r.tags} ${r.tags === 1 ? 'tag' : 'tags'}`);
      if (r.links) bits.push(`${r.links} links`);
      if (r.skipped) bits.push(`${r.skipped} already existed`);
      let msg = bits.length
        ? `Imported ${bits.join(' · ')} — from ${r.scanned} files across ${r.folders + 1} folders.`
        : `Nothing new to import from ${r.scanned} files.`;
      if (r.undated) {
        msg += ` ${r.undated} had no readable date and were left out (${r.undatedSample.join(', ')}${
          r.undated > r.undatedSample.length ? '…' : ''
        }).`;
      }
      setImportResult(msg);
    } finally {
      setImporting(false);
    }
  };

  const choose = async () => {
    const res = await api.settings.chooseVault();
    if (!res) return;
    if (!res.changed) {
      setNotice('That folder already holds the current vault.');
      return;
    }
    setDbPath(res.dbPath);
    setNotice(
      res.existed
        ? 'Opened the existing vault in that folder. Reloading…'
        : 'Vault copied to the new folder (the old file stays as a backup). Reloading…'
    );
    setTimeout(() => window.location.reload(), 900);
  };

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings">
        <div className="settings-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="settings-nav">
          {TABS.map((t) => (
            <button key={t.id} className={'settings-tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={14} /> {t.label}
            </button>
          ))}
        </div>

        <div className="settings-body">
        {tab === 'general' && (
          <>
            <UpdateSettings />
        <div className="settings-row">
          <div>
            <div className="s-label">Appearance</div>
            <div className="s-hint">How Habitat looks.</div>
          </div>
          <div className="seg">
            <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>
              <Icon name="sun" size={13} /> Light
            </button>
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>
              <Icon name="moon" size={13} /> Dark
            </button>
          </div>
        </div>

        <Attachments />

        <div className="settings-row col">
          <div>
            <div className="s-label">Vault location</div>
            <div className="s-hint">
              Your entire Habitat lives in one SQLite file. Pick a folder that already contains a vault to open it;
              otherwise your current vault is copied there.
            </div>
          </div>
          <code className="vault-path">{dbPath}</code>
          <div className="s-hint">
            Habitat code <code>{code}</code> — a stable id for this file, safe to share.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" onClick={choose}>
              Change location…
            </button>
            <button className="btn subtle" onClick={() => api.settings.reveal()}>
              Show in Finder
            </button>
          </div>
          {notice && <div className="s-notice">{notice}</div>}
        </div>

          </>
        )}

        {tab === 'automations' && <Automations />}

        {tab === 'capture' && <TelegramSettings />}

        {tab === 'api' && <ApiSettings />}

        {tab === 'import' && (
        <div className="settings-row col">
          <div>
            <div className="s-label">Import</div>
            <div className="s-hint">
              <b>Whole vault</b> walks every subfolder: date-named files become daily notes, the rest become notes.{' '}
              <b>Daily notes folder</b> treats every file in it as a daily note, reading the date from the filename —
              use this if your daily notes aren't named starting with the date.{' '}
              <code>#tags</code> become tags and <code>[[wikilinks]]</code> become real links. Nothing already here is
              overwritten.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" disabled={importing} onClick={() => runImport('vault')}>
              {importing ? 'Importing…' : 'Whole vault…'}
            </button>
            <button className="btn" disabled={importing} onClick={() => runImport('daily')}>
              Daily notes folder…
            </button>
          </div>
          {importResult && <div className="s-notice">{importResult}</div>}
        </div>

        )}

        {tab === 'scripts' && (
        <div className="settings-row col">
          <div>
            <div className="s-label">Your variables</div>
            <div className="s-hint">
              Write a JavaScript expression (or a full body using <code>return</code>) and it appears in the same{' '}
              <code>/</code> menu under “Your variables”. Scripts get a <code>habitat</code> object for reading your
              data — every call is async except <code>today()</code>, so <code>await</code> them:
            </div>
            <details className="var-ref-fold">
              <summary>Script reference</summary>
            <div className="var-ref">
              {[
                ['habitat.count(type?)', 'how many objects — e.g. count("task")'],
                ['habitat.objects(type?)', 'all objects of a type'],
                ['habitat.search(text)', 'objects matching text'],
                ['habitat.tasks(date?)', 'tasks due on a date, default today'],
                ['habitat.daily(date?)', "a daily note, default today's"],
                ['habitat.recent()', 'the objects you edited last'],
                ['habitat.pinned()', 'everything you have pinned'],
                ['habitat.counts()', 'object count per type'],
                ['habitat.tags()', 'your tags, with usage counts'],
                ['habitat.types()', 'your object types'],
                ['habitat.me()', 'your name'],
                ['habitat.today()', "today's date, e.g. 2026-07-25"],
              ].map(([call, what]) => (
                <div className="var-ref-row" key={call}>
                  <code className="var-ref-name">{call}</code>
                  <span className="var-ref-val">{what}</span>
                </div>
              ))}
            </div>
            </details>
            <div className="s-hint">
              Examples: <code>{"await habitat.count('task') + ' tasks'"}</code> ·{' '}
              <code>{'`Hi ${await habitat.me()}`'}</code> ·{' '}
              <code>{"(await habitat.tasks()).map(t => t.title).join(', ')"}</code>
            </div>
            <div className="s-hint">
              The same <code>habitat</code> object is available to Custom script widgets on the dashboard, where you can
              render whatever you like instead of returning text.
            </div>
          </div>
          {vars.map((v, i) => (
            <div className="var-row" key={v.id}>
              <input
                className="field var-name"
                placeholder="Name"
                value={v.name}
                onChange={(e) => saveVars(vars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <input
                className="field var-code"
                placeholder="new Date().getFullYear()"
                value={v.code}
                onChange={(e) => saveVars(vars.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}
              />
              <button className="icon-btn" onClick={() => saveVars(vars.filter((_, j) => j !== i))} aria-label="Delete variable">
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
          <button className="add-prop" onClick={() => saveVars([...vars, { id: clientUid(), name: '', code: '' }])}>
            <Icon name="plus" size={13} /> Add variable
          </button>
        </div>

        )}

        </div>
      </div>
    </div>
  );
}

/**
 * What attachments are taking up, and a way to sweep what nothing points at.
 * Deliberately manual: walking every note to prove a file is unused is not
 * something to do on a timer.
 */
function Attachments() {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.files.stats>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = () => api.files.stats().then(setStats);
  useEffect(() => {
    load();
  }, []);

  if (!stats) return null;

  const sweep = async () => {
    setBusy(true);
    try {
      const { removed, freed } = await api.files.gc();
      setNote(removed ? `Removed ${removed} unused ${removed === 1 ? 'file' : 'files'}, freeing ${size(freed)}.` : 'Nothing to clean up.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-row col">
      <div>
        <div className="s-label">Attachments</div>
        <div className="s-hint">
          Images and files you paste, drop or attach live in a <code>files</code> folder next to the vault, named by
          their contents — so the same picture used twice is stored once, and copying the vault folder takes everything
          with it.
        </div>
      </div>
      <code className="vault-path">{stats.dir}</code>
      <div className="s-hint">
        {stats.count} {stats.count === 1 ? 'file' : 'files'} · {size(stats.bytes)}
        {stats.unusedCount > 0 && ` · ${stats.unusedCount} no longer referenced (${size(stats.unusedBytes)})`}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn" disabled={busy || stats.unusedCount === 0} onClick={sweep}>
          {busy ? 'Cleaning…' : 'Clean up unused'}
        </button>
      </div>
      {note && <div className="s-notice">{note}</div>}
    </div>
  );
}

function size(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}
