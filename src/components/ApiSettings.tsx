import { useEffect, useState } from 'react';
import { api } from '../api';
import type { HttpApiConfig } from '../types';
import { Icon } from './Icons';

const ROUTES: [string, string][] = [
  ['GET /health', 'is it up'],
  ['POST /mcp', 'MCP over HTTP, for agents'],
  ['GET /types', 'your object types'],
  ['GET /objects?type=task&limit=20', 'objects, optionally by type'],
  ['GET /objects/:id', 'one object'],
  ['POST /objects', '{ typeId, title, props, content }'],
  ['PATCH /objects/:id', '{ title, props, pinned, content }'],
  ['DELETE /objects/:id', 'remove an object'],
  ['GET /search?q=coffee', 'search titles and note text'],
  ['GET /search?q=type:task+due:week', '…with filters mixed in'],
  ['GET /backlinks/:id', 'what links here'],
  ['GET /daily?date=2026-07-26', "a day's note"],
  ['POST /daily/append', '{ text, date? }'],
  ['GET /tasks?date=2026-07-26', 'tasks due that day'],
  ['GET /people?q=ana', 'the address book'],
  ['GET /people/:id · POST /people', 'one person · { name, props }'],
  ['GET /people/birthdays?within=60', 'whose birthday is coming up'],
  ['GET /people/fields · /me', 'addable details · your own card'],
  ['GET /tags · /stats', 'tags with counts · vault stats'],
  ['GET /automations', 'your rules'],
  ['POST /automations/:id/run', 'run one now'],
  ['POST /capture', '{ text } — same routing as Telegram'],
];

/** The JSON an MCP client needs to reach this vault. */
const mcpSnippet = (token: string, port: number, dir: string) =>
  JSON.stringify(
    {
      mcpServers: {
        habitat: {
          command: 'node',
          args: [`${dir}/mcp/server.mjs`],
          env: { HABITAT_TOKEN: token, HABITAT_URL: `http://127.0.0.1:${port}` },
        },
      },
    },
    null,
    2
  );

/** Local-only HTTP API: scripts, Shortcuts, and the MCP server for agents. */
export function ApiSettings() {
  const [cfg, setCfg] = useState<HttpApiConfig | null>(null);
  const [status, setStatus] = useState<{ running: boolean; port: number } | null>(null);
  const [reveal, setReveal] = useState(false);
  const [notice, setNotice] = useState('');
  const [appDir, setAppDir] = useState('/path/to/Habitat');

  useEffect(() => {
    api.http.config().then(setCfg);
    api.http.status().then(setStatus);
    api.app.info().then((i) => setAppDir(i.appDir));
  }, []);

  if (!cfg) return null;

  const base = `http://127.0.0.1:${cfg.port}`;

  const apply = async (patch: Partial<HttpApiConfig>) => {
    const next = await api.http.save(patch);
    setCfg(next);
    const res = await api.http.apply();
    setStatus(await api.http.status());
    setNotice(res.ok ? (res.running ? `Listening on ${base}` : 'Stopped.') : res.error || 'Could not start.');
  };

  const regenerate = async () => {
    if (!confirm('Replace the token? Anything using the old one stops working.')) return;
    const token = crypto.randomUUID().replace(/-/g, '');
    await apply({ token });
    setNotice('New token — update anything that used the old one.');
  };

  const copy = (text: string, what: string) => {
    navigator.clipboard.writeText(text);
    setNotice(`${what} copied.`);
  };

  return (
    <div className="settings-row col">
      <div>
        <div className="s-label">Local API</div>
        <div className="s-hint">
          Reads and writes your vault over HTTP, bound to <code>127.0.0.1</code> only — nothing on your network can
          reach it, and every request needs the token below. Runs while Habitat is open.
        </div>
      </div>

      <div className="tg-row">
        <span className="s-sub">Server</span>
        <button
          className={'toggle' + (cfg.enabled ? ' on' : '')}
          onClick={() => apply({ enabled: !cfg.enabled })}
          aria-label={cfg.enabled ? 'Stop the server' : 'Start the server'}
        >
          <span className="knob" />
        </button>
        <span className="tg-state">
          {status?.running ? (
            <>
              <Icon name="check" size={13} /> listening on {base}
            </>
          ) : (
            'stopped'
          )}
        </span>
      </div>

      <div className="tg-row">
        <span className="s-sub">Port</span>
        <input
          className="field"
          style={{ maxWidth: 120 }}
          value={cfg.port}
          onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) || 0 })}
          onBlur={() => apply({ port: cfg.port })}
        />
      </div>

      <div className="tg-row">
        <span className="s-sub">Token</span>
        <input className="field mono" readOnly value={reveal ? cfg.token : '•'.repeat(24)} />
        <button className="btn subtle" onClick={() => setReveal((v) => !v)}>
          {reveal ? 'Hide' : 'Show'}
        </button>
        <button className="btn subtle" onClick={() => copy(cfg.token, 'Token')}>
          Copy
        </button>
        <button className="btn subtle" onClick={regenerate}>
          New
        </button>
      </div>

      <div className="api-try">
        <code>{`curl -H "Authorization: Bearer ${reveal ? cfg.token : 'YOUR_TOKEN'}" "${base}/objects?type=task"`}</code>
        <button
          className="icon-btn"
          aria-label="Copy example"
          onClick={() => copy(`curl -H "Authorization: Bearer ${cfg.token}" "${base}/objects?type=task"`, 'Example')}
        >
          <Icon name="doc" size={13} />
        </button>
      </div>

      {notice && <div className="s-notice">{notice}</div>}

      <div>
        <div className="s-label">AI agents (MCP)</div>
        <div className="s-hint">
          Point Claude Desktop, Claude Code, Cursor or any MCP client at the vault. It gets tools for searching,
          reading, capturing and creating, plus the address book — who someone is, whose birthday is next, and who
          you are.
        </div>
      </div>

      <div className="tg-row">
        <span className="s-sub">Over HTTP</span>
        <input className="field mono" readOnly value={`${base}/mcp`} />
        <button className="btn subtle" onClick={() => copy(`${base}/mcp`, 'MCP URL')}>
          Copy
        </button>
      </div>
      <div className="s-hint">
        For clients that take a URL and a token instead of a command — Osaurus, LM Studio and the like. Served by
        Habitat itself while the server above is on, with the same token as the API.
      </div>

      <div className="tg-row">
        <span className="s-sub">Let it edit</span>
        <button
          className={'toggle' + (cfg.mcpEdit ? ' on' : '')}
          onClick={() => apply({ mcpEdit: !cfg.mcpEdit })}
          aria-label={cfg.mcpEdit ? 'Keep MCP read-and-add only' : 'Allow MCP to edit and delete'}
        >
          <span className="knob" />
        </button>
        <span className="tg-state">
          {cfg.mcpEdit ? 'can change, delete and run automations' : 'read and add only'}
        </span>
      </div>

      <div className="s-hint">
        For a client that spawns a command instead, use this — its own <code>HABITAT_EDIT</code> decides what it may
        change, so the toggle above doesn't apply to it.
      </div>

      <div className="api-try">
        <code>{mcpSnippet(reveal ? cfg.token : 'YOUR_TOKEN', cfg.port, appDir)}</code>
        <button className="icon-btn" aria-label="Copy MCP config" onClick={() => copy(mcpSnippet(cfg.token, cfg.port, appDir), 'MCP config')}>
          <Icon name="doc" size={13} />
        </button>
      </div>

      <details className="var-ref-fold">
        <summary>Endpoints</summary>
        <div className="var-ref">
          {ROUTES.map(([route, what]) => (
            <div className="var-ref-row" key={route}>
              <code className="var-ref-name">{route}</code>
              <span className="var-ref-val">{what}</span>
            </div>
          ))}
        </div>
      </details>

      <div className="s-hint">
        The token is stored in the vault file. Treat it like a password — anyone who has it can read and change
        everything in this habitat.
      </div>
    </div>
  );
}
