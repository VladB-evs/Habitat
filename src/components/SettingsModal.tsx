import { useEffect, useState } from 'react';
import { api } from '../api';
import { GuideLink } from '../docs';
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
  { id: 'api', label: 'API', icon: 'globe' },
  { id: 'scripts', label: 'Scripts', icon: 'code' },
  { id: 'import', label: 'Import & Export', icon: 'doc' },
] as const;

type Tab = (typeof TABS)[number]['id'];

/** What the `habitat` object hands to scripts. Kept folded — it's reference, not chrome. */
const SCRIPT_API: [string, string][] = [
  ['habitat.count(type?)', 'how many objects'],
  ['habitat.objects(type?)', 'all objects of a type'],
  ['habitat.search(text)', 'objects matching text'],
  ['habitat.tasks(date?)', 'tasks due on a date'],
  ['habitat.daily(date?)', 'a daily note'],
  ['habitat.recent()', 'the objects you edited last'],
  ['habitat.pinned()', 'everything you have pinned'],
  ['habitat.counts()', 'object count per type'],
  ['habitat.tags()', 'your tags, with usage counts'],
  ['habitat.types()', 'your object types'],
  ['habitat.me()', 'your name'],
  ['habitat.today()', "today's date"],
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = useApp();
  const [dbPath, setDbPath] = useState('');
  const [notice, setNotice] = useState('');
  const [vars, setVars] = useState<UserVar[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState('');
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

  const runExport = async (format: 'markdown' | 'json') => {
    setExportResult('');
    setExporting(true);
    try {
      const r = await api.exportVault(format);
      if (!r) return;
      if ('error' in r) return setExportResult(`Could not export: ${r.error}`);
      const bits = [`${r.objects} ${r.objects === 1 ? 'object' : 'objects'}`];
      if (r.types) bits.push(`${r.types} ${r.types === 1 ? 'type' : 'types'}`);
      if (r.files) bits.push(`${r.files} ${r.files === 1 ? 'attachment' : 'attachments'}`);
      setExportResult(`Exported ${bits.join(' · ')} to ${r.path}`);
    } finally {
      setExporting(false);
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
    setNotice(res.existed ? 'Opened the vault in that folder. Reloading…' : 'Vault copied there. Reloading…');
    setTimeout(() => window.location.reload(), 900);
  };

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div
      className="palette-backdrop prefs-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="prefs">
        <nav className="prefs-rail">
          <h2>Settings</h2>
          {TABS.map((t) => (
            <button key={t.id} className={'prefs-tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={14} /> {t.label}
            </button>
          ))}
        </nav>

        <div className="prefs-pane">
          <div className="prefs-head">
            <h3>{current.label}</h3>
            <div className="set-ctl">
              <GuideLink slug={current.id} />
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                <Icon name="x" size={15} />
              </button>
            </div>
          </div>

          <div className="prefs-body">
            {tab === 'general' && (
              <>
                <section className="set-sec">
                  <div className="set-group">
                    <div className="set-item">
                      <div className="set-name">Appearance</div>
                      <div className="seg">
                        <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>
                          <Icon name="sun" size={13} /> Light
                        </button>
                        <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>
                          <Icon name="moon" size={13} /> Dark
                        </button>
                      </div>
                    </div>
                    <UpdateSettings />
                  </div>
                </section>

                <section className="set-sec">
                  <div className="set-title">Vault</div>
                  <div className="set-group">
                    <div className="set-item stack">
                      <div>
                        <div className="set-name">Location</div>
                        <div className="set-note">
                          Habitat code <code>{code}</code> — safe to share.
                        </div>
                      </div>
                      <code className="vault-path">{dbPath}</code>
                      <div className="set-ctl">
                        <button className="btn" onClick={choose}>
                          Change location…
                        </button>
                        <button className="btn subtle" onClick={() => api.settings.reveal()}>
                          Show in Finder
                        </button>
                      </div>
                      {notice && <div className="s-notice">{notice}</div>}
                    </div>
                    <Attachments />
                  </div>
                </section>
              </>
            )}

            {tab === 'automations' && <Automations />}
            {tab === 'capture' && <TelegramSettings />}
            {tab === 'api' && <ApiSettings />}

            {tab === 'scripts' && (
              <section className="set-sec">
                <div className="set-title">Your variables</div>
                <div className="set-group">
                  <div className="set-item stack">
                    <div className="set-note">
                      JavaScript that runs when you pick it from the <code>/</code> menu.
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
                        <button
                          className="icon-btn"
                          onClick={() => saveVars(vars.filter((_, j) => j !== i))}
                          aria-label="Delete variable"
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    ))}
                    <button className="add-prop" onClick={() => saveVars([...vars, { id: clientUid(), name: '', code: '' }])}>
                      <Icon name="plus" size={13} /> Add variable
                    </button>
                  </div>

                  <details className="set-fold">
                    <summary>Script reference</summary>
                    <div className="set-fold-body">
                      <div className="set-note">
                        Every call is async except <code>today()</code> — <code>await</code> them. The same object is
                        available to Custom widgets on the dashboard.
                      </div>
                      <div className="var-ref">
                        {SCRIPT_API.map(([call, what]) => (
                          <div className="var-ref-row" key={call}>
                            <code className="var-ref-name">{call}</code>
                            <span className="var-ref-val">{what}</span>
                          </div>
                        ))}
                      </div>
                      <div className="set-note">
                        <code>{"await habitat.count('task') + ' tasks'"}</code> ·{' '}
                        <code>{'`Hi ${await habitat.me()}`'}</code>
                      </div>
                    </div>
                  </details>
                </div>
              </section>
            )}

            {tab === 'import' && (
              <section className="set-sec">
                <div className="set-title">From Obsidian</div>
                <div className="set-group">
                  <div className="set-item">
                    <div>
                      <div className="set-name">Whole vault</div>
                      <div className="set-note">Date-named files become daily notes, the rest become notes.</div>
                    </div>
                    <button className="btn" disabled={importing} onClick={() => runImport('vault')}>
                      {importing ? 'Importing…' : 'Choose folder…'}
                    </button>
                  </div>
                  <div className="set-item">
                    <div>
                      <div className="set-name">Daily notes folder</div>
                      <div className="set-note">Every file becomes a daily note, dated from its filename.</div>
                    </div>
                    <button className="btn" disabled={importing} onClick={() => runImport('daily')}>
                      Choose folder…
                    </button>
                  </div>
                  <div className="set-item">
                    <div className="set-note">
                      <code>#tags</code> and <code>[[wikilinks]]</code> are converted. Nothing already here is
                      overwritten.
                    </div>
                  </div>
                </div>
                {importResult && (
                  <div className="s-notice" style={{ marginTop: 10 }}>
                    {importResult}
                  </div>
                )}

                <div className="set-title" style={{ marginTop: 18 }}>
                  Export
                </div>
                <div className="set-group">
                  <div className="set-item">
                    <div>
                      <div className="set-name">Markdown &amp; files</div>
                      <div className="set-note">A folder per type, attachments included. Imports back into Habitat.</div>
                    </div>
                    <button className="btn" disabled={exporting} onClick={() => runExport('markdown')}>
                      {exporting ? 'Exporting…' : 'Choose folder…'}
                    </button>
                  </div>
                  <div className="set-item">
                    <div>
                      <div className="set-name">JSON backup</div>
                      <div className="set-note">One file, everything exactly as stored.</div>
                    </div>
                    <button className="btn" disabled={exporting} onClick={() => runExport('json')}>
                      Choose folder…
                    </button>
                  </div>
                  <div className="set-item">
                    <div className="set-note">Your API and Telegram tokens are never included.</div>
                  </div>
                </div>
                {exportResult && (
                  <div className="s-notice" style={{ marginTop: 10 }}>
                    {exportResult}
                  </div>
                )}
              </section>
            )}
          </div>
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
      setNote(
        removed ? `Removed ${removed} unused ${removed === 1 ? 'file' : 'files'}, freeing ${size(freed)}.` : 'Nothing to clean up.'
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="set-item">
      <div>
        <div className="set-name">Attachments</div>
        <div className="set-note">
          {stats.count} {stats.count === 1 ? 'file' : 'files'} · {size(stats.bytes)}
          {stats.unusedCount > 0 && ` · ${stats.unusedCount} unused (${size(stats.unusedBytes)})`}
          {note && ` — ${note}`}
        </div>
      </div>
      <div className="set-ctl">
        <button className="btn subtle" disabled={busy || stats.unusedCount === 0} onClick={sweep}>
          {busy ? 'Cleaning…' : 'Clean up'}
        </button>
      </div>
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
