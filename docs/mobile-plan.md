# Habitat on mobile — migration plan

Preparation for a Capacitor build. The goal is a UI that works with one thumb on a
390×844 screen **without a second codebase and without regressing the desktop app**.

Everything below is structured so that each phase is independently shippable: after
any phase, `npm run dev` on the desktop looks and behaves exactly as it does today.

---

## 1. Where we're starting from

Measured, not guessed:

| Thing | Count | Why it matters |
|---|---|---|
| `src/styles.css` | 10,619 lines | One flat sheet. Editing it in place for mobile is how this becomes unmaintainable. |
| `@media` queries in it | 3 (one is `prefers-reduced-motion`) | Effectively zero responsive design today. |
| `:hover` rules | 161 | 29 of them **reveal UI that is otherwise invisible**. On touch that UI does not exist. |
| `title="…"` tooltips | 104 | Never fire on touch. Fine as long as nothing is *only* explained there. |
| Fixed pixel widths ≥100px | 81 | Sidebar 240, palette 620, modal 800, props panel 288… all wider than or close to a phone. |
| `position: fixed` blocks | 16 | Each one needs safe-area insets and keyboard-aware placement. |
| `-webkit-app-region` rules | 14 | Electron-only. Inert but harmless in a webview; the drag strips must not eat taps. |
| Mouse-only drag loops | 4 | `App.tsx:161` (split divider), `blockHandle.tsx:131`, `Dashboard.tsx:363-364` (×2). These are dead on touch. |
| Components rendering `.popover` | 17 | Anchored floating menus; they need to become sheets. |
| `.app { height: 100vh }` | 1 | Wrong unit for mobile browsers/webviews. |
| IPC surface | 1 seam (`window.habitat.invoke`), 41 channels, allowlisted in `electron/preload.js` | The Capacitor port is genuinely one file. |

The good news: the app already has strong seams — a single `api.ts` transport, a
`store.tsx` that owns panes/navigation, a `viewModel.ts` that separates data shaping
from table rendering, and `SplitControls` already factored out of every page header.

The bad news is concentrated in four places: **the shell**, **hover-only affordances**,
**anchored popovers**, and **`TypeTable` / `CalendarView` / `CanvasView`**, which are
inherently pointer-and-width-hungry.

---

## 2. The four primitives

The whole point of doing this structurally is that we build these first and then
*migrate call sites*, rather than hand-tuning 60 components. Nothing in phases 2+
should invent its own mobile handling.

### 2.1 Two independent mode flags — not one "isMobile"

Narrowness and pointer type are different questions and they disagree on real
devices (iPad: wide + coarse; touchscreen laptop: wide + coarse; phone landscape:
short + coarse).

```
src/layout.tsx
  useLayout() -> { narrow: boolean, coarse: boolean, short: boolean }
```

Backed by `matchMedia`, mirrored onto the root element as `data-narrow` /
`data-coarse` so CSS can branch without JS, and JS can branch where the *structure*
(not just the styling) has to change.

- `narrow` (`max-width: 768px`) drives **layout**: drawer vs pinned sidebar, cards vs table.
- `coarse` (`pointer: coarse`) drives **affordance**: reveal-on-hover vs always-visible, hit sizes.
- `short` (`max-height: 480px`) drives **keyboard-open** compensation.

### 2.2 A separate mobile stylesheet, never edits to `styles.css`

```
src/styles.css      — untouched desktop sheet (except token extraction, §3.1)
src/mobile.css      — imported after it; every rule scoped under
                      :root[data-narrow] or :root[data-coarse]
```

This is the single most important rule of this project. If mobile CSS leaks into
the 10.6k-line sheet, nobody will ever be able to reason about either platform
again. The mobile sheet should stay small because most adaptation goes through
tokens (`--hit`, `--page-pad`, `--sidebar-w`) rather than rule overrides.

### 2.3 `<Reveal>` and `<RowActions>` — one answer for 29 hover reveals

Today each reveal is bespoke: `.day-task:hover .row-del { opacity: 1 }`,
`.tag-card:hover .row-del`, `.sr-deck:hover .sr-deck-menu`, `.w-wrap:hover .w-tools`…

Replace with one utility class plus one component:

- `.reveal` — hidden by default; visible on `@media (hover: hover)` parent-hover
  **and** on `:focus-within` (keyboard users get it today by accident, not by design);
  on `[data-coarse]` it renders at reduced opacity but is always tappable.
- `<RowActions>` — for rows with **2+ hidden actions** (table rows, day tasks, decks,
  tag cards, widgets). Renders inline icon buttons on fine pointers; renders a single
  `⋯` that opens an action sheet on coarse ones. Three tiny 24px buttons crammed into
  a list row is not a mobile design.

Which of the 29 becomes which is a per-site call, listed in Phase 3.

### 2.4 `<Sheet>` — one answer for popovers, modals and the palette

A bottom sheet with a drag-to-dismiss handle, backdrop, safe-area padding and
scroll containment. On `[data-narrow]`, `.popover` / `.modal` / `.palette` render
into it; on desktop they keep their current anchored positioning untouched.

17 components render `.popover` and they all compute anchor coordinates
(`getBoundingClientRect`). The sheet path ignores those coordinates entirely, which
is why this has to be a real component and not a CSS override.

---

## 3. Phases

### Phase 0 — Foundation (invisible on desktop) — **done**

No visual change at all. This phase exists so every later phase has somewhere to put
its code.

1. `index.html`: `viewport-fit=cover` on the viewport meta.
2. `.app`: `100vh` → `100dvh`; add `env(safe-area-inset-*)` padding tokens.
3. Root reset for webviews: `overscroll-behavior: none`, `-webkit-tap-highlight-color: transparent`, `-webkit-text-size-adjust: 100%`, `touch-action` review.
4. Extract layout constants in `styles.css` to custom properties: `--sidebar-w` (240), `--page-pad`, `--hit` (control hit target, 28 desktop / 44 coarse). This is the only edit to `styles.css` in the whole project.
5. Add `src/layout.tsx` (§2.1) and `src/mobile.css` (§2.2), wired but empty.
6. **Convert the 4 mouse-only drag loops to Pointer Events** — `App.tsx` split divider, `blockHandle.tsx`, `Dashboard.tsx` ×2. Pointer Events cover mouse *and* touch in one code path, so this deletes a future fork rather than creating one. Includes `setPointerCapture` so drags survive leaving the element.
7. **Dev-only HTTP transport for `api.ts`.** `window.habitat` doesn't exist in a plain browser, so today the app cannot be opened at 390px in a browser at all — which makes mobile work unverifiable. Add a `HABITAT_DEV`-guarded `POST /ipc/:channel` route to the existing `electron/server.js` (it already binds 127.0.0.1-only with a bearer token, and `preload.js` already keeps a `CHANNELS` allowlist to reuse), and make `api.ts` pick the HTTP transport when `window.habitat` is absent. **This is also literally the Capacitor seam** — the native build will use the same switch.

**Acceptance:** desktop pixel-identical; `vite` alone opens in a browser at 390×844 and talks to a running Electron instance; divider and widget drags work with a finger.

**Landed as:** `src/layout.tsx`, `src/mobile.css`, `electron/devbridge.js`, plus the
transport switch in `src/api.ts` and a `handle()` helper in `electron/main.js` that
registers a channel with IPC and the dev bridge at once (so the bridge reaches
`settings:get`, `ai:availability` and friends without duplicating them).

Verified: 390×844 → `data-narrow` + `data-coarse`, `--hit: 44px`, `.app` 844px;
1280×900 → no flags, `--hit: 28px`. 173 tests pass, `tsc --noEmit` clean, production
build clean. Bridge rejects non-Vite origins and unknown channels.

Two things deliberately **not** done here, both recorded so they aren't lost:
- HTML5 drag-and-drop reorder (`Dashboard` shield, `Agenda`, `TypeTable`,
  `typeViews`, `TasksPage`) does not fire on touch at all. It needs a pointer-based
  rewrite per page, which belongs in each page's Phase 4 slot.
- `blockHandle`'s pointer tracking is a hover affordance with no touch equivalent,
  so it is switched off on coarse pointers rather than converted. Its long-press
  replacement is Phase 2.

### Phase 1 — The shell — **done**

This is the phase you specifically asked for, and it comes early because nothing
else is testable on a phone until the shell fits.

1. **Right-hand drawer.** The `<Sidebar>` component itself is not rewritten — only how `App.tsx` mounts it. On `[data-narrow]`: `position: fixed; right: 0`, full height, `translateX(100%)` when closed, backdrop, spring animation matching the existing `softSpring`. Opened by a trigger in the bottom-right thumb arc and by a swipe from the right edge. The existing `.edge-reveal` hover-peek (`App.tsx:232`) becomes a left-edge → right-edge **swipe** on coarse pointers.
2. **`api.window.trafficLights()` becomes a no-op** off Electron, and `.drag-strip` / `-webkit-app-region` regions get `display: none` on narrow so they can't swallow taps at the top of the screen.
3. **Stacked-only splitting.** In `store.tsx`, `split(dir)` coerces `dir` to `'col'` when narrow, and the "side by side" button is hidden in both `App.tsx:316` and `SplitControls.tsx`. The pane model, the divider, the ratio drag, the close animation and the "everything opens beside" behaviour all survive unchanged — a phone just gets top/bottom.
4. **Pane bar at 390px.** `Main` / `Side view` / `active` tag / three buttons don't fit. Collapse to: dot + close, with the split direction control removed (there's only one direction now).
5. **Thumb bar** (bottom-anchored, safe-area-padded, narrow only): back, search, active-pane indicator, drawer toggle. This replaces the sidebar's role as the always-available control surface. *Optional — see open questions.*

**Acceptance:** at 390×844 you can navigate, open an object beside (which stacks
below), drag the divider, close a pane, and reach every sidebar destination.

**Landed as:** `src/components/SidebarDrawer.tsx`, `src/components/EdgeSwipe.tsx`,
a `narrow` branch in the `Shell` of `src/App.tsx`, the coercion in `src/store.tsx`,
and the drawer/FAB/edge/pane-bar rules in `src/mobile.css`.

Verified at 390×844: drawer 282px off the right edge with the page still visible
behind it; `split('row')` produced `dir-col` with two full-width stacked panes;
pane bar down to dot + close with `-webkit-app-region` neutralised; right-edge
swipe opened the drawer; left-edge swipe popped the history stack; navigating
closed the drawer; Canvas absent from the nav. At 1280×900 the desktop shell is
unchanged — pinned sidebar, Canvas present, both split buttons, no FAB or strips.
173/173 tests, `tsc` and build clean.

Two notes for whoever works on this next:

- **Motion animations freeze in a hidden browser pane.** `requestAnimationFrame`
  is paused there, so a drawer sits at its initial transform and an
  `AnimatePresence` exit never commits — which also means a pane closed by the
  back gesture stays in the DOM. Check React state (is the FAB back?) rather than
  the DOM when a headless check disagrees with you.
- **The drag gesture and the enter/exit animation are on two different elements**
  (`.drawer` slides, `.drawer-drag` is what the finger moves). A `drag` takes
  ownership of its axis, so sharing one element leaves the exit animation fighting
  the gesture after a drag-to-close.

The dev bridge moved from port 37374 to **37380**: `electron/mcp.test.mjs` binds
37374 for its own server, so the two collided whenever the app was running during
a test run.

### Phase 2 — Hover → touch — **done**

Build `<Reveal>` and `<RowActions>` (§2.3), then migrate. The 29 reveal sites, grouped
by what they should become:

- **Always-visible at reduced opacity** (single action, plenty of room):
  `sidebar:hover .collapse-btn`, `tr:hover .url-go`, `.media-block .media-grip`,
  `.file-chip-x`, `.code-block .code-tools`, `.obj-prop .prop-edit`,
  `.ag-day.empty` body, `.ag-day .ag-task.add`.
- **`<RowActions>` overflow sheet** (2+ actions competing for a narrow row):
  `.day-task` (`.row-open` + `.row-del` + `.pick-box`), `.daily-list-row .row-del`,
  `tr` (`.open-pill` + `.chip-add` + `.row-del`), `.tag-card .row-del`,
  `.sr-row-tools`, `.sr-note-del`, `.sr-deck-menu`, `.cv-tile-menu`, `.w-wrap` tools.
- **Gesture instead** (the hover *is* the interaction, not a reveal):
  `.block-grip` → long-press on the block; `.cv-item .cv-port` (canvas connection
  ports) → tap-to-select then tap-port; `.w-resize` → explicit edit mode.
- **Drop on touch** (decoration): `.pane.dimmed:hover`, `.split-divider:hover`,
  `.pk:hover .pk-plus`, scrollbar thumb hover.

Also in this phase: wrap the remaining ~130 cosmetic `:hover` rules in
`@media (hover: hover)` so touch devices don't get sticky hover states after a tap.
Mechanical, low-risk, done in one pass.

**Acceptance:** no action in the app is reachable only by hovering. Audit script in
CI: grep for `:hover` rules that set `opacity: 1` / `visibility` outside a
`@media (hover: hover)` block.

**What it actually took — and the plan above was wrong in two useful ways.**

**`RowActions` was never built, because the crowding wasn't real.** Reading the
call sites showed that both `.day-task` and TypeTable's `tr` already open their
object when you click the space between their controls — so `.row-open` and
`.open-pill` are *duplicates of the primary touch gesture*, not extra actions.
They are hidden on coarse pointers, which leaves every row with at most
`chip-add` + `row-del`. Nothing needs an overflow menu. Deleting a planned
component beat building it.

**The 29 reveals became one token rather than 29 overrides.** The base rules now
read `opacity: var(--reveal-idle, 0)` (18 sites), and `mobile.css` sets
`--reveal-idle: 0.55` under `[data-coarse]`. Faint rather than full, so a list
still reads as its contents with the controls as a quieter layer — which is what
the hover was buying on the desktop anyway. Two reveals needed more than opacity
and got explicit rules: the empty agenda day, and the two redundant Open controls.

**`Sheet` was pulled forward from Phase 3** (`src/components/Sheet.tsx`) — drag
handle, drag-to-dismiss, safe-area padding, `82dvh` cap. Phase 3 now only has to
route the existing overlay families into it. Same two-element drag/animate split
as the drawer, for the same reason.

**The block grip got its long press.** This was the one genuinely lost action:
Phase 0 switched the hover tracker off on coarse pointers, which left no way to
reach Duplicate / Delete / Turn into. A 480ms press on a block now opens the same
menu; travel over 8px cancels it so scrolling always wins, and `contextmenu` is
suppressed so the system callout doesn't cover it. The early return in
`BlockHandle` had to change — the menu now outlives the hover, because on touch
there was never a hover to open it.

**157 hover rules gated**, by script, with 16 correctly split so their non-hover
halves (`:checked`, `:focus-within`, `:focus-visible`, `.selected`, `.on`,
`.w-resizing`) stay unconditional — keyboard focus must reveal these whatever the
pointer is. Verified three ways: the brace balance and `:hover` count held across
the transform; the browser parsed exactly 157 `@media (hover: hover)` blocks, so
nothing was silently dropped as malformed; and a nesting-aware audit reports **0**
ungated top-level `:hover` rules remaining. That audit is the CI check this phase
asked for — it lives in the phase's verification notes and should be lifted into
the repo when CI grows a lint step.

Verified live at 390×844: `--reveal-idle` resolves to 0.55, `.row-del` is visible
and tappable, `.row-open` is gone, long press opens the block menu, a pan cancels
it. At 1280×900 `--reveal-idle` is unset, both controls return to `opacity: 0`,
and the page is pixel-identical to before the phase. 173/173 tests, `tsc` and
build clean.

### Phase 3 — Overlays become sheets — **done**

Build `<Sheet>` (§2.4), then route the overlay families through it on narrow:

1. `SearchPalette` and `AskPanel` → full-screen, input pinned above the keyboard.
2. `SettingsModal` (and the settings sub-panels: Api, Sync, Telegram, Update) → full-screen with a back header; 800px modal → 100%.
3. The 17 `.popover` call sites → bottom sheet. Highest-traffic first: `cells.tsx`, `DateField`, `PropEditor`, `TypeEditor`, `ViewBar`, `blockHandle`, `SelectionMenu`.
4. `MentionList` / `SlashList` / `EmojiList` / `suggestionPopup` — these anchor to a caret inside the editor and must sit **above the on-screen keyboard**. Use `visualViewport` so they track the keyboard instead of being covered by it. This is the fiddliest item in the whole plan.

**Acceptance:** nothing renders off-screen or under the keyboard at 390×844 with a
text field focused.

**Landed as:** a `viewport()` helper in `src/util.ts` returning the *visual*
viewport, used by `popPos` and by `placePopup` in `src/suggestionPopup.ts`; a
visualViewport `resize`/`scroll` listener in the suggestion renderer so a popup
placed a frame before the keyboard slid up re-places itself; and one overlay
block in `src/mobile.css`.

The 17 popover call sites were **not** touched. Each computes its own left/top
inline, so the anchoring is overridden centrally with `!important` — the one
place in this project that earns it, the alternative being a `narrow` prop
threaded through seventeen components. Modals go full-screen, the palette goes
full-screen, and every input is floored at 16px so iOS stops zooming the page on
focus.

Verified at 390×844: the view bar's filter popover comes up as a full-width sheet
with a grab handle and 44px rows; the palette computes to 390px wide with a 16px
input; a probe `.modal` computes to 390×844 with no radius. At 1280×900 a probe
popover still honours its inline `left: 100px / top: 80px` and the modal keeps
its 18px radius — the overrides are inert there. 173/173 tests, `tsc` and build
clean.

One measurement trap, same as Phase 1: `getBoundingClientRect` on the palette
reported 367×793 while its computed width was 390px. That gap is the frozen
entrance `scale` in a hidden pane, not a layout bug — read computed styles rather
than rects when checking layout headlessly.

### Phase 4 — Pages, one at a time — **partly done**

**The floating action pill (added to the plan during Phase 4, at the user's
request.)** A page header on the desktop is a title on the left and five or six
controls on the right; at 390px those controls were running off the edge with the
primary button half cut off.

They now sit in a **second floating pill matching the drawer button** — same
height, radius, shadow and distance off the bottom edge — beside it but separate
from it, because the two answer different questions: the round one is "where do I
go", the pill is "what can I do on this page". It floats over the content rather
than docking, so a page still reads full height.

`src/components/PageActions.tsx` portals a page's action cluster into a slot that
`App.tsx` renders inside each `.pane`. Per pane rather than per screen, because
panes stack: a single bar fixed to the window would belong to whichever page
rendered last while sitting under the other one. `:empty` collapses the slot on
the desktop, where the controls render in the header exactly as before.

Details that only showed up on screen:

- The drawer button's gutter belongs on the **slot**, not on the scrolling row.
  As padding on the row it sits at the end of the scroll content, so the last
  button still passed underneath the drawer button on the way past.
- The pill scrolls, which means something can be off-screen — and it must never
  be the thing the page is for. `.btn.primary` and `.split-btn` are pulled to the
  head of the row with `order: -1`, so New / Add / Event is the one control always
  reachable without scrolling.
- Floating means it covers the foot of the page, so `.pane-scroll` gets
  `padding-bottom` — scoped with `:has(.pane-action-slot:not(:empty))` so only
  pages that actually have a pill pay for the room.

**The database table becomes a list of cards.** The one layout that genuinely
cannot fit: side-scrolling it would mean the name scrolls away from its own
values. Rather than a second renderer, the same markup is re-laid-out — rows
become cards, cells become labelled lines. The label comes from a `data-label`
attribute added to each property cell in `TypeTable.tsx`, because the header row
that used to name the columns is gone. Editing, selection and the cell editors
are untouched; only the boxes move. Verified with a Book row: title, then
AUTHOR / STATUS / RATING with their live select chips. At 1280px it computes back
to `display: table` with no pseudo-labels.

Wired up: Tasks, People, TypeTable, Dashboard, DailyNotes, StudyView, TagsView.

**Layouts that assumed two dimensions** now collapse to one on narrow: the
checklist's Scheduled/Unscheduled columns, the dashboard's six-column widget grid,
the tag/people/deck/board card grids, the widget picker. The dashboard also needs
`grid-auto-rows: minmax(92px, auto)` and `grid-row: auto` — widget heights are in
92px units chosen against a six-wide grid, and at one column a widget that was
three units tall clipped its own contents.

The ViewBar's five view modes are 440px wide and always will be, so that row
scrolls sideways on its own rather than being clipped by the pane. Verified: the
document no longer scrolls horizontally on any page checked (`scrollWidth` 390 =
`clientWidth` 390).

**The calendar** drops to its day view on narrow. Seven columns of 390px are 50px
each — narrower than the text of one event. `useCalendarNav` returns `'day'`
whatever the saved preference says, and deliberately does not *write* that
preference, so the desktop still opens on the week you chose. The Day/Week switch
is not rendered where there is nothing to switch between.

**Object properties** stack — a 140px label beside a value leaves the value half a
line at this width, so the label goes above it as a small caps caption.

**The editor's selection toolbar** stops being a bubble beside the selection —
that spot is under your thumb and about to be covered — and becomes a strip across
the bottom of the visible viewport, `bottom: var(--kb)`, directly above the
keyboard, with its rows scrolling sideways and 44px targets. Measured: full width,
bottom edge 844 with no keyboard and 508 with one.

**Still open:** the HTML5 drag-and-drop reorders deferred from Phase 0 (Dashboard
shield, Agenda, TypeTable, typeViews, TasksPage) — they do not fire on touch at
all and each needs a pointer-based rewrite. Then the rest of Phase 5 and Capacitor.

**Note on the test suite:** `mcp.test.mjs`'s "editing is off until it is turned on"
fails roughly one run in five. It does this on a clean checkout too — confirmed by
stashing every change and running the suite five times — so it is a pre-existing
flake, not a regression from this work. Worth fixing separately; it will otherwise
make every future CI run look untrustworthy.

### Phase 4 — original plan

Ordered by traffic and by how much rework each needs. Each is a self-contained unit
of work; none blocks another.

| Page | Work |
|---|---|
| `ObjectPage` + `Editor` | `page-head` → sticky compact bar; `PropsPanel` (288px) → collapsible section above content; `SelectionMenu` → fixed toolbar above keyboard instead of a selection bubble |
| `DailyNotes` | Mostly padding and the row reveals from Phase 2 |
| `TasksPage` + `Agenda` | Drag-to-schedule needs a tap-target alternative (`Agenda.tsx` drag/drop); backlog already stacks under days at ≤900px |
| `TypeTable` (1114 lines) | **The hard one.** A grid does not work at 390px. Add a card-list renderer consuming the same `viewModel.ts` output — the data shaping is already separated, which is why this is feasible. Keep the table for wide, switch on `narrow`. `ViewBar` filter/sort chips → horizontally scrollable, editing via sheet |
| `Dashboard` | 6-column widget grid → 1–2 columns (a container query at 620px already does part of this); drag-reorder and resize gated behind an explicit edit mode rather than always-live |
| `CalendarView` (605 lines) | Week grid → single-day column on narrow; pointer-drag create/move/resize already converted in Phase 0, but needs larger grab handles and a long-press-to-create gesture |
| `Study` (`StudyView`, `DeckPage`, `StudySession`) | `StudySession` is nearly mobile-shaped already — mostly sizing. Rating buttons to the bottom thumb arc |
| `People`, `TagsView` | Card grids; mostly padding and Phase 2 reveals |
| `CanvasView` (1153 lines) | **Last, and scope it deliberately.** Wheel-zoom → pinch-zoom, pointer pan already works after Phase 0, but node creation/connection/resize is a desktop interaction model. Recommendation: ship **pan + zoom + open item + move item** on mobile, and leave graph editing to desktop until there's a reason not to |

### Phase 5.1 — Keyboard-aware shell — **done**

`100dvh` does not shrink for a soft keyboard — it accounts for browser chrome,
not the keyboard — so the shell kept its full height and hid its lower half
behind it. `src/layout.tsx` now publishes two values from `visualViewport` on
every change: `--vvh`, the height actually visible, and `--kb`, how much the
keyboard is covering. It also exposes a measured `keyboard` flag (no media query
reports this) and mirrors `data-keyboard`.

`.app` is sized in `--vvh`, so everything anchored to the shell's bottom follows
for free. **The catch that only showed up on screen:** `position: fixed` resolves
against the *layout* viewport, which does not shrink — so the drawer button, the
drawer, its backdrop and the edge strips all stayed put behind the keyboard even
though the shell had resized. They are `position: absolute` inside `.app` now.
Overlays that genuinely are fixed keep `bottom: var(--kb)` instead.

Measured with a spoofed 336px keyboard at 390×844: shell 844 → 508, drawer button
825 → 489, action pill 492, popover sheet 504 — all inside the visible 508.

In a stacked split the focused pane also takes the room (22/78) for as long as the
keyboard is up, returning to the user's own ratio afterwards — `ratio` itself is
never touched. And once the shell has resized, whatever has focus is scrolled into
view by the **caret's** position rather than the element's, since in a long note
the element is the whole editor and its top is nowhere near the cursor.

**Needs a look on a real device:** the split squeeze is the one part that could
not be verified here — its spring cannot complete while `requestAnimationFrame`
is paused in a hidden pane, so the panes stay at their pre-animation sizes. The
target arithmetic runs through the same `animate(mainSize, target)` path that is
already proven, but seeing it is a device job.

### Phase 5.2 — The app asks its own questions — **done**

`window.confirm` is a webview dialog: unstyleable, captioned with the app's
origin, ignoring the safe area, and on iOS arriving as a system alert that looks
like the page has misbehaved. There were 18 of them, every one in front of a
delete, plus one `alert`.

The awkward part is that `confirm` is *synchronous* and a React dialog cannot be.
Rather than lift state into thirteen components, `src/confirm.tsx` asks through a
promise answered by one `<ConfirmHost />` at the top of the tree, so each call
site changes by one `await`:

```
if (!confirm('Delete this?')) return;          // before
if (!(await ask('Delete this?'))) return;      // after
```

Every call site turned out to already be inside an `async` function, so the
conversion type-checked with no other changes. Dismissing by backdrop, Escape or
drag resolves `false` — otherwise the caller waits forever. With no host mounted
it falls back to `window.confirm` rather than silently proceeding.

It is a bottom sheet on narrow and a centred 420px dialog on the desktop (the
same component; `left`/`width` rather than a centring transform, because Motion
owns `transform` while it animates). Verified end to end: Cancel keeps the
record, Delete removes it from the database.

### Phase 5.3 — Keyboards, gestures, scroll — **done**

**The right keyboard.** `TextCell` gained a `mode` prop, so `url`, `email` and
`phone` properties ask for their own keyboard and turn off autocorrect and
autocapitalisation — an address mangled into words is worse than no help at all.
One prop threaded through `UrlCell` and `LinkCell` covers all three, rather than
three separate inputs. Search boxes get `enterkeyhint="search"`, so the keyboard's
action key says what it will do. Numbers already had `inputmode="decimal"`.

**Who owns a touch**, written down in one block in `mobile.css` because these
rules only make sense against each other — outermost first: the 16px screen edges
(`touch-action: none`, drawer and back), then drag handles (the split divider, a
widget's resize corner, also `none`), then the drawer (`pan-y` — it scrolls its
own list and Motion reads the horizontal dismissal), then everything else, which
keeps the browser's own scrolling untouched. Only something that genuinely
consumes a drag takes `touch-action` away; nothing is set defensively.

**Scroll.** `overscroll-behavior: contain` on every scroller, so a list that runs
out stops rather than dragging its parent — and at the top of a page, rather than
letting the webview pull the whole app down. Chrome (rows, nav items, menu items)
stops being text-selectable on touch, where a slightly-long press otherwise
selects it; inputs, the editor and `[contenteditable]` are explicitly exempt.

Verified at 375×812: `enterkeyhint="search"` and `autocapitalize="off"` on the
search box, `inputmode="tel"` / `"email"` on a person's phone and email fields,
edge strips at `touch-action: none`, scrollers containing, nav items
`user-select: none` with the editor still `text`. At 1280×900 all of it is
inert — `user-select: auto`, `overscroll-behavior: auto`.

### Phase 6 — Capacitor (iOS)

**What this is, and what it is not.** The iOS build wraps the same `dist/` the
desktop loads — there is no second codebase. What it does *not* wrap is the
vault: an iOS webview has no Node and no SQLite, so the phone has no data of its
own. It reads and writes the Habitat **running on your Mac**, over the network,
through the same bridge the browser preview uses.

That makes it a real app for judging the UI in your hand, and not yet a real app
for using away from your desk. Giving it its own data is the next project, and
it is a big one: 110 IPC channels backed by SQLite, which on device means either
`@capacitor-community/sqlite` reimplementing them or the Supabase hub becoming
the source of truth.

**LAN mode.** `HABITAT_LAN=1` binds the bridge to `0.0.0.0` and requires a bearer
token on every request — a real exposure, hence opt-in and hence the token, where
the localhost mode needs neither. It prints the two build variables on startup;
they go into `.env.local`, which is gitignored because the token must not be
committed.

**`Keyboard.resize: 'none'`** in `capacitor.config.ts` is load-bearing, not a
preference. The other modes resize the webview when the keyboard appears, which
hides the keyboard from `visualViewport` — and everything in Phase 5.1 is built
on `visualViewport` reporting it. Let iOS do the resizing and the action pill
stops riding above the keyboard and the split stops making room.

`ios/` is gitignored: `npx cap add ios` generates it.

### Phase 5 — Device reality

1. Keyboard: `visualViewport` handling, scroll-into-view on focus, `inputmode` / `enterkeyhint` on inputs.
2. Gesture conflicts: canvas pan vs page scroll vs drawer swipe vs iOS back-swipe. Needs a deliberate `touch-action` map, not per-component guesses.
3. Replace `confirm()` / `alert()` (used in `Sidebar.tsx:120` and elsewhere) with the `<Sheet>` confirm — webview dialogs are jarring and unstyleable.
4. Scroll: momentum, `overscroll-behavior: contain` on every scroll container, sticky-header behaviour under rubber-banding.
5. Then, and only then, Capacitor: the transport switch from Phase 0.7 is already in place, so this is config, native shell, and icons rather than app surgery.

---

## 4. Verification loop

Start the app as usual (`npm run dev`); the dev bridge comes up alongside it and
logs its port. Then open **http://127.0.0.1:5173** in a browser and size the window
to the viewport you care about. The page talks to whatever vault the Electron
instance has open.

```bash
HABITAT_USERDATA=/tmp/habitat-scratch npm run dev
```

Use a throwaway `HABITAT_USERDATA` when the work might write junk — one instance
per profile, and two processes on one SQLite vault will corrupt it.

**Reload after resizing.** The mode flags update on `resize` / `orientationchange`
/ media-query change, which is what a real device and a dragged Electron window
both fire — but some automated browser surfaces change viewport metrics without
dispatching any of them, and the flags then look stale. If `data-narrow` disagrees
with the window, reload before believing it.

Each phase should end with a pass at 390×844 (iPhone portrait), 430×932 (Pro Max)
and 768×1024 — the iPad case is the one that catches `isMobile`-style mistakes,
because it must come out as **desktop layout + touch affordances**.

Desktop non-regression is checked by the same app at ≥1280px after every phase.

---

## 5. Decisions

1. **No bottom bar.** A permanent nav bar costs vertical space on the most
   space-starved screen we have and duplicates entries that are one tap away inside
   the drawer (Search and Ask already sit at the top of `<Sidebar>`). Instead the two
   screen edges are used symmetrically:
   - **right edge swipe**, plus a floating button in the bottom-right thumb arc → drawer
   - **left edge swipe** → back, matching the platform gesture everyone already has
     in their hands, with the existing `page-head` back button unchanged for taps

   This costs zero permanent chrome and leaves the top-left back button as the
   discoverable path for people who don't swipe.

2. **Canvas is disabled on mobile.** The nav entry is hidden when `narrow`, and
   `CanvasView` / `CanvasHome` render a short "available on desktop" note if reached
   by link or restored from a hash. This removes the single largest item from Phase 4
   and the `.cv-port` gesture work from Phase 2.

3. **iPad gets the desktop layout with touch affordances.** This is exactly what the
   two-flag design in §2.1 produces for free: `narrow = false` (desktop layout,
   pinned sidebar, side-by-side splitting, real tables) and `coarse = true` (44px hit
   targets, no hover-only reveals, sheets over anchored popovers where a popover
   would be fiddly). The `narrow` breakpoint is therefore set at **700px**, below
   every iPad including the 744pt mini — with an extra `coarse and max-height: 500px`
   clause so a phone in landscape (844×390) still counts as narrow.

4. **Dashboard edit mode is unified.** Both platforms get the same explicit mode,
   which the page already has (`edit` state, "Edit dashboard" button). The only
   change is that the button stops hiding behind `.dash:hover .dash-edit`, and
   drag/resize stay gated on `edit` for fine and coarse pointers alike.
