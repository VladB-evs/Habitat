# Habitat 🪴

An object-based personal knowledge base for macOS. Local-first, no folders, no markdown files —
everything is a typed object in a SQLite database, and objects connect to each other.


> **This is not open source.** The code is readable here, but all rights are reserved —
> see [LICENSE](LICENSE).

## Install

Grab the latest `.dmg` from [Releases](../../releases). Builds are ad-hoc signed rather than
notarised, so macOS quarantines the download — clear it once after dragging the app to
Applications:

```bash
xattr -dr com.apple.quarantine /Applications/Habitat.app
```
After that the app updates itself: it checks GitHub for new releases, downloads them in the
background, and swaps its own bundle when you press **Restart & install** in Settings → General.

## Run from source

```bash
npm install
npm run dev        # dev mode with hot reload
npm start          # build + run the real app
npm run typecheck  # tsc --noEmit
npm test           # node:test
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
- **People** — the address book, with its own view instead of a table: a card for you, upcoming
  birthdays, and a person page with contact details. Still ordinary objects, so `@`-mentions,
  relations and backlinks all work.
- **Habitat** — a whole vault. Switch between them from the sidebar; each has its own file.

## Editor

| Trigger | What it does |
| --- | --- |
| `@` | link an object |
| `#` | tag |
| `/` | commands, blocks, date/time variables, your own scripts — best match first |
| `/task` | turn the line into a real unscheduled task and link to it |
| `:` | emoji picker — the full CLDR set, searchable |
| `/image` `/file` | attach from your computer — or just paste or drag one in |
| `/table` | a table, with a toolbar for rows, columns and headers |
| `/code` | a code block, syntax highlighted, with a language picker |
| `$…$` | inline maths, rendered with KaTeX — a searchable symbol palette opens while you're inside one |
| `⌘K` | search everything — see below |
| `⌘\` | show/hide the sidebar |

Every top-level block has a grip in the left margin: drag it to move the block, or click it to
duplicate, delete, or turn it into a heading, list or quote.

## Images and files

Paste, drag in, or use `/image` and `/file`. An attachment becomes a block of its own — a rounded
card you pick up by the handle in the margin and drop anywhere else in the note. Images take a
caption and a width; anything else shows as a file card that opens in whatever handles it.
Attachments also work as a **Files** property, so a type can carry them as data rather than prose.

They're stored in a `files` folder beside the vault, named by the SHA-256 of their contents and
sharded one level deep:

```
My Habitat/
  My Habitat.db
  files/a3/a3f9…c1.png
```

Addressing by content means the same image pasted twenty times is one file on disk, names never
collide, and copying the vault folder takes everything with it. Nothing points at a file any more?
Settings → General shows what attachments take up and sweeps the unreferenced ones — a deliberate
button rather than reference counting, because walking what actually refers to a file is the only
answer that stays right.

## Search

`⌘K` searches titles, nicknames and the text of every note, including daily entries, through an
FTS5 index kept in step by triggers — so it stays an index lookup rather than a scan as the vault
grows, and results come back ranked with the matching text around them.

Filters mix in with the words, and the palette offers them as one-click chips:

| Filter | Matches |
| --- | --- |
| `type:task` | one kind of object (plurals forgiven) |
| `tag:habitat` | anything carrying that tag |
| `is:pinned` | pinned only |
| `due:today` `due:tomorrow` `due:week` `due:overdue` | any date property in that window |
| `created:today` `created:yesterday` `created:week` `created:month` | when it was made |
| `edited:…` | when it was last touched |

So `type:task due:week invoice` is a legitimate query, and the same string works through the HTTP
API and the MCP `search` tool.

## Views, filters and sort

Every type list has a toolbar: pick a view, filter it, sort it. What you set is remembered per
type, with the vault.

- **Table** — the spreadsheet, with editable cells
- **Gallery** — cards with a snippet and the properties that are filled in
- **Board** — a column per option of a select property; drag a card to change it
- **Calendar** — by any date property, or by when things were created or edited
- **Checklist** — for task-shaped types: drag between Scheduled and Unscheduled to set or clear
  a date

Task-shaped types get a **Hide done** toggle in the toolbar that clears finished work out of
every view at once.

**Filters** stack, and each one reads as a sentence — *Status is none of Done*, *Due is in the
next 7 days*, *Name contains draft*. **Sort** takes any field. Both work on the type's properties
and, for types that have none, on Created and Edited — so even a bare Note type can be shown
newest-first or narrowed to this week.

The dashboard is a drag-and-resize widget grid. Any page can be opened in a **side view** — a
third of the window, with the active pane clearly marked.

## Automations

Settings → Automations builds rules in plain language: *when* something happens, *only if* some
conditions hold, *then* run a list of actions.

- **Triggers** — object created/edited/deleted, a property changes to a value, a date property
  comes up, someone's birthday comes up, every day or on chosen weekdays at a time, or when the
  app opens
- **Look at** — a scheduled rule can be pointed at a type and given conditions, then act either
  once on the whole matching set or once per object. *Every day at 09:00, look at every task
  where Status is not Done and Edited is not in the last 7 days* → one notification listing them.
  Nothing matching means the rule stays quiet.
- **Conditions** — any property plus Name, Created and Edited, compared with is / is not /
  contains / before / after / in the last N days / **not** in the last N days, which is how you
  ask for what's gone untouched. The builder shows what a rule matches right now, live.
- **Actions** — set a property, create an object, add a line to today's daily note, add a tag,
  link objects, pin, notify, or message you on Telegram
- **Values** — `{{link}}` (a real link, not just a name), `{{title}}`, `{{prop:id}}`, `{{today}}`,
  `{{tomorrow}}`, `{{now}}`, `{{date+7}}`, `{{turning}}`/`{{age}}` in birthday rules, and
  `{{count}}`/`{{list}}` for a rule watching a whole set. The `{ }` button on every text field
  lists them. A daily-note line from a set-watching rule is followed by the matches as real
  links, so the note connects to each one.
- **Examples** — “Start from an example” drops in working rules (stale-task nudge, today's
  agenda, overdue check, weekly review, birthdays) already wired to your own types

## Capture from your phone

Settings → Capture connects your own Telegram bot. Message it and the text lands in the vault; the
first word routes it — `daily …` appends to today's note, `task …` creates a Task, anything else
becomes your fallback type. Habitat polls while it's open, and Telegram holds messages until then.

A bot is reachable by anyone who finds it, so the bridge is paired rather than open: Settings shows
a six-character code, and only the account that sends that code — from a private chat, within 15
minutes — is linked. After that every message is checked against both that chat *and* that sender;
anything else is dropped without a reply, and group chats are refused outright. The rules live in
one pure function, [`gate()`](electron/telegram.js), covered by `npm test`.

## Local API and AI agents

Settings → API runs a loopback-only HTTP server (bearer token, `127.0.0.1` only):

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" "http://127.0.0.1:37373/objects?type=task"
```

Endpoints cover objects, search, backlinks, daily notes, tasks, tags, stats, automations and
capture, plus the address book — `/people`, `/people/:id`, `/people/birthdays`, `/people/fields`
and `/me`. [`mcp/tools.mjs`](mcp/tools.mjs) puts the same surface behind MCP, so Claude, Cursor or
any MCP client can read and write the vault — reads plus create/capture by default, edits and
deletes only when they're allowed.

Two ways in, same tools. A client that spawns a command runs
[`mcp/server.mjs`](mcp/server.mjs) over stdio, with `HABITAT_TOKEN` and optionally `HABITAT_EDIT=1`.
A client that only takes a URL — Osaurus, LM Studio — points at `http://127.0.0.1:37373/mcp`, which
the app serves itself (streamable HTTP, stateless) behind the same bearer token; what it may change
is the "Let it edit" toggle in Settings → API. Both configs are shown there ready to paste.

## Releasing

```bash
npm version patch && git push --follow-tags
```

The [release workflow](.github/workflows/release.yml) builds for Apple Silicon and publishes to
GitHub Releases, which is also the update feed.

## Stack

Electron (main process owns the DB via `node:sqlite`, no native build step), React + Vite +
TypeScript renderer, TipTap editor, Motion for animation. IPC goes over a small allowlisted bridge
in `electron/preload.js`.
