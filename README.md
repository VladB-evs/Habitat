# Habitat 🪴

An object-based personal knowledge base for macOS. Local-first, no folders, no markdown files —
everything is a typed object in a SQLite database, and objects connect to each other.


> **This is not open source.** The code is readable here, but all rights are reserved —
> see [LICENSE](LICENSE).

## Install

Grab the latest `.dmg` from [Releases](../../releases). Builds aren't code-signed, so the first
launch needs a right-click → **Open** (or `xattr -dr com.apple.quarantine /Applications/Habitat.app`).
After that the app updates itself: it checks GitHub for new releases, downloads them in the
background, and swaps its own bundle when you press **Restart & install** in Settings → General.

## Run from source

```bash
npm install
npm run dev        # dev mode with hot reload
npm start          # build + run the real app
npm run typecheck  # tsc --noEmit
npm run dist       # build installers into release/
```

## Where your data lives

One SQLite file per habitat, in a folder you choose — plain, portable, and safe to sync or back
up. Settings → General shows the exact path and the habitat's code.

## Concepts

- **Type** — a schema (icon, colour, properties). Types are databases; open one from the sidebar.
- **Object** — one row/page: title, property values, rich-text content.
- **Property** — text, number, select, multi-select, date, rating, progress, relation and more.
  Select values get a stable colour derived from the value itself.
- **Link** — created from `@`-mentions in any editor and from relation properties. Backlinks sit at
  the bottom of every object page; the Graph view draws the whole web.
- **Daily Note** — one object per day, keyed by date.
- **Habitat** — a whole vault. Switch between them from the sidebar; each has its own file.

## Editor

| Trigger | What it does |
| --- | --- |
| `@` | link an object |
| `#` | tag |
| `/` | commands, blocks, date/time variables, your own scripts |
| `/task` | turn the line into a real unscheduled task and link to it |
| `:` | emoji picker — the full CLDR set, searchable |
| `⌘K` | search everything |
| `⌘\` | show/hide the sidebar |

## Views

Types render as a **table**, a **checklist** (drag between Scheduled and Unscheduled to set or
clear a date), or a **calendar**. The dashboard is a drag-and-resize widget grid. Any page can be
opened in a **side view** — a third of the window, with the active pane clearly marked.

## Automations

Settings → Automations builds rules in plain language: *when* something happens, *only if* some
conditions hold, *then* run a list of actions.

- **Triggers** — object created/edited/deleted, a property changes to a value, a date property
  comes up, every day or on chosen weekdays at a time, or when the app opens
- **Actions** — set a property, create an object, add a line to today's daily note, add a tag,
  link objects, pin, notify, or message you on Telegram
- **Templates** — `{{link}}` (a real link, not just a name), `{{title}}`, `{{prop:id}}`,
  `{{today}}`, `{{tomorrow}}`, `{{now}}`, `{{date+7}}`

## Capture from your phone

Settings → Capture connects your own Telegram bot. Message it and the text lands in the vault; the
first word routes it — `daily …` appends to today's note, `task …` creates a Task, anything else
becomes your fallback type. Habitat polls while it's open, and Telegram holds messages until then.

## Local API and AI agents

Settings → API runs a loopback-only HTTP server (bearer token, `127.0.0.1` only):

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" "http://127.0.0.1:37373/objects?type=task"
```

Endpoints cover objects, search, backlinks, daily notes, tasks, tags, stats, automations and
capture. [`mcp/server.mjs`](mcp/server.mjs) puts the same surface behind MCP, so Claude, Cursor or
any MCP client can read and write the vault — reads plus create/capture by default, edits and
deletes only with `HABITAT_EDIT=1`. Settings → API shows a ready-to-paste config.

## Releasing

```bash
npm version patch && git push --follow-tags
```

The [release workflow](.github/workflows/release.yml) builds on macOS and Windows and publishes to
GitHub Releases, which is also the update feed.

## Stack

Electron (main process owns the DB via `node:sqlite`, no native build step), React + Vite +
TypeScript renderer, TipTap editor, Motion for animation. IPC goes over a small allowlisted bridge
in `electron/preload.js`.
