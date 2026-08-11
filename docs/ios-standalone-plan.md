# Habitat on iOS — the standalone app

The mobile UI is done (see `mobile-plan.md`). This is the other half: giving the
phone its own vault, so the app works with the Mac closed.

---

## 1. Why the tethered build was only a harness

An iOS webview has no Node and no `node:sqlite`. The vault lives in
`electron/db.js`, which runs in Electron's main process. So the first Capacitor
build talks to the Mac over the network — fine for judging the UI in your hand,
useless on a train.

**The Supabase hub cannot stand in for it.** That was my first instinct and it is
wrong: `supabase/schema.sql` deliberately stores rows as opaque JSON keyed by
table and id, and says so in its own header — *"nothing here can be queried or
reported on server-side"*. It is a change feed for syncing devices, not a
database to run an app against. Building the phone on it would mean pulling the
entire vault on every launch and querying it in memory.

The phone needs a real local database, which is what the sync design assumed all
along.

---

## 2. What the port actually costs

I measured the coupling rather than guessing, and the codebase turns out to be
unusually well prepared for this.

| Module | Lines | Ties to Node |
|---|---|---|
| `db.js` | 3539 | `node:sqlite`, 6 uses of `fs`/`path`, `randomUUID`/`randomBytes` |
| `canvas.js`, `study.js` | 700 | `randomUUID` only |
| `srs.js`, `recur.js`, `markdown.js` | 400 | **none** |
| `sync.js`, `supabase.js` | 328 | **none** — the transport is injected by design |
| `synclog.js` | 225 | one require |
| `files.js` | 130 | `fs`/`path` throughout, `createHash('sha256')` |

The SQLite surface is the headline. Across 3539 lines, `db.js` uses exactly:

```
db.prepare()   db.exec()   db.close()
stmt.run()     stmt.get()  stmt.all()
```

all synchronous. That is a shim, not a rewrite — the query logic, the schema
migrations, the 110 channels all run unchanged behind a compatible object.

---

## 3. The architecture

```
  ┌─────────────────────────── WKWebView ───────────────────────────┐
  │                                                                 │
  │  renderer (unchanged)                                           │
  │     src/api.ts ──postMessage──┐                                 │
  │                               │                                 │
  │  ┌─────────── Web Worker ─────▼──────────────────────────────┐  │
  │  │  vault/sqlite.ts    DatabaseSync-shaped shim              │  │
  │  │  @sqlite.org/sqlite-wasm  →  OPFS (real file, real WAL)   │  │
  │  │  db.js + canvas + study + srs + recur   ← unchanged       │  │
  │  │  sync.js  →  supabase.js  →  the hub over HTTPS           │  │
  │  └───────────────────────────────────────────────────────────┘  │
  │                                                                 │
  └─────────────────────────────────────────────────────────────────┘
```

**Why a worker.** OPFS synchronous access handles — the only way to give WASM
SQLite a real file with real durability — exist only inside a worker. `db.js` is
synchronous top to bottom, so it has to live there too. This is a feature rather
than a tax: `api.ts` already chooses its transport at runtime, so a worker is
just a third one alongside Electron IPC and the dev bridge, and the heavy work
comes off the main thread for free.

**iOS 17+.** That is the floor for OPFS sync access handles in WKWebView.

---

## 4. The work, in order

Each step leaves the desktop app working and is independently checkable.

**1. ~~Extract the vault core.~~ Not needed — measured, not assumed.**

I had this down as the largest step and the one carrying all the regression
risk: move the vault modules and invert their dependencies so they take a
database handle instead of `require`-ing Node.

A throwaway experiment killed it. Vite bundles the existing CommonJS straight to
ESM with `build.commonjsOptions.include`, and `resolve.alias` swaps `node:sqlite`,
`fs`, `path` and `crypto` for browser shims at build time. The whole vault —
`db.js`, `canvas`, `study`, `srs`, `recur`, `synclog`, `files` — came out at
138 kB (35 kB gzipped) and exported **all 110 channels**, with not one line of
`db.js` changed.

So the desktop keeps its Node modules, the phone gets shims, and there is one
copy of the logic. The biggest risk in this plan turned out not to exist.

**2. The SQLite shim.** `prepare/exec/close` and `run/get/all` over
`@sqlite.org/sqlite-wasm` on OPFS. Small, and testable against the same suite by
running the existing tests a second time through the shim.

**3. Platform helpers.** `randomUUID` is native in browsers; `randomBytes`
becomes `getRandomValues`; `createHash('sha256')` needs a *synchronous* SHA-256
(SubtleCrypto is async), which is a ~40 line function or a tiny dependency.

**4. Attachments.** `files.js` swaps `fs` for OPFS. The blob sync already exists
in `sync.js` (`BLOBS_PER_CYCLE`), so photographs follow the same path they do
between two desktops today.

**5. The worker transport.** `api.ts` gains its third branch; the worker boots
the vault, runs the same channel map, and answers by `postMessage`.

**6. Sync on device.** `sync.js` and `supabase.js` port as-is. Sign in on the
phone, and it is the same vault.

**7. Onboarding.** The phone has no "choose a folder" step — it makes one vault
in OPFS and offers sign-in. Habitat switching goes away on mobile.

---

## 5. Building it — local only

No CI, no GitHub, no release pipeline. The iOS app is built on this machine and
run on a phone over a cable, which needs only a free Apple ID: Xcode signs it
with a personal team and the app lasts seven days before it wants rebuilding.
The existing `release.yml` is untouched and keeps shipping the Mac app.

The `.gitignore` still commits `ios/` and ignores only `build/`, `Pods/` and
`output/` — not for CI, but because `Info.plist` and the entitlements are real
project state worth keeping in the repo.

**The one footgun:** `.env.local`. While it holds `VITE_HABITAT_BRIDGE`, every
build points the app at the Mac instead of its own vault. Delete it once the
local vault works, or the standalone app will silently still be the tethered one.

---

## 6. Where this stands

Done:
- The transport seam in `api.ts`, which already picks between Electron IPC, the
  dev bridge, and (next) the worker.
- `capacitor.config.ts`, with `Keyboard.resize: 'none'` — load-bearing, see above.
- **Proof the vault runs in a browser bundle**: all 110 channels, no changes to
  `db.js`.

Next, in order:
1. **The SQLite shim** — `prepare/exec/close`, `run/get/all` over
   `@sqlite.org/sqlite-wasm` on OPFS. The one real unknown left, and it can be
   tested in Node before any phone is involved.
2. **Platform shims** — `path` is fifteen lines; `crypto` needs a synchronous
   SHA-256 for `files.js`, since SubtleCrypto is async.
3. **Attachments** — `files.js` on OPFS instead of `fs`.
4. **The worker transport** — `api.ts`'s third branch.
5. **Sync** — `sync.js` and `supabase.js` port unchanged; sign in and the phone
   is the same vault.
6. **Mobile onboarding** — one vault, no folder picker, no habitat switching.

## 7. Two pre-existing test failures, worth fixing first

Both reproduce on a clean checkout with every change stashed, and both pass in
isolation but fail in the full suite — so they are test-isolation problems, not
product bugs:

- `mcp.test.mjs` — "editing is off until it is turned on" (~1 run in 5)
- `agenda.test.mjs` — "a day's tasks include what starts then" (3 of 3 today)

These 173 tests are the safety net for everything above. A safety net that cries
wolf is worse than none.
