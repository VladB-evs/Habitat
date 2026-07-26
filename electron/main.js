const { app, BrowserWindow, dialog, ipcMain, Notification, shell } = require('electron');
const telegram = require('./telegram');
const updater = require('./updater');
const pkg = require('../package.json');
const server = require('./server');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const {
  initDb, api, setNotifier, setTelegramSender, switchVault, openVault, closeDb, seedFlavor, resetToBlank, seedPeople, ensurePersonType, ensureTagType,
} = require('./db');

app.setName('Habitat');
if (process.env.HABITAT_USERDATA) app.setPath('userData', process.env.HABITAT_USERDATA);

// One instance per profile — a second launch focuses the existing window
// (two processes on the same SQLite/WAL vault can corrupt or fail with disk I/O errors).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

let win;
let currentDbPath = '';
// The near-empty stub boot() creates before onboarding runs, if a fresh install. Once onboarding
// relocates it to the user's chosen folder, the original is dead weight and gets deleted.
let preOnboardDbPath = null;

const configPath = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  const c = { ...loadConfig(), ...patch };
  fs.writeFileSync(configPath(), JSON.stringify(c, null, 2));
}

// HABITAT_TEST_FOLDER lets automated tests bypass the native folder dialog,
// which Electron/OS-level UI can't be driven through the renderer.
async function pickFolderDialog(title, message) {
  if (process.env.HABITAT_TEST_FOLDER) return process.env.HABITAT_TEST_FOLDER;
  const res = await dialog.showOpenDialog(win, {
    title,
    message: message || 'Habitat stores everything in one habitat.db file inside the folder you pick.',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
}

// Filesystem-safe but human-readable — keeps the habitat's actual name/casing,
// only strips characters a folder/file name can't contain.
function safeName(s) {
  return String(s || '').replace(/[\/:\0]/g, '-').replace(/\s+/g, ' ').trim().replace(/\.+$/, '') || 'Habitat';
}

/**
 * Every habitat gets its own folder, named after it, containing one file with
 * that same name — e.g. "Work Habitat/Work Habitat.db". Appends " 2", " 3", …
 * if a same-named habitat folder already exists in the chosen parent.
 */
function makeHabitatFile(parentDir, name) {
  const base = safeName(name);
  let folder = path.join(parentDir, base);
  for (let n = 2; fs.existsSync(folder); n++) folder = path.join(parentDir, `${base} ${n}`);
  fs.mkdirSync(folder, { recursive: true });
  return path.join(folder, `${path.basename(folder)}.db`);
}

// Irreversibly remove a vault's main file plus its WAL/SHM/journal sidecars, then
// its containing folder too if that leaves it empty (it was made to hold this vault
// and nothing else — if something else has since been added to it, this is a no-op).
function removeVaultFiles(dbPath) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* already gone */
    }
  }
  try {
    fs.rmdirSync(path.dirname(dbPath));
  } catch {
    /* not empty, or already gone — leave it */
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 560,
    minHeight: 600,
    show: !process.env.HABITAT_SHOT,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    backgroundColor: '#141413',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const view = process.env.HABITAT_VIEW || '';
  if (process.env.HABITAT_DEV) {
    win.loadURL('http://127.0.0.1:5173/' + (view ? '#' + view : ''));
  } else {
    const index = path.join(__dirname, '..', 'dist', 'index.html');
    win.loadFile(index, view ? { hash: view } : undefined);
  }

  // Screenshot mode for automated visual checks: HABITAT_SHOT=/path.png [HABITAT_VIEW=/graph]
  if (process.env.HABITAT_SHOT) {
    win.webContents.once('did-finish-load', () => {
      win.showInactive();
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.HABITAT_SHOT, img.toPNG());
        } catch (e) {
          console.error('screenshot failed:', e);
        }
        app.exit(0);
      }, Number(process.env.HABITAT_SHOT_DELAY || 1800));
    });
  }
}

// Habitats are separate vault files the user can switch between.
// config.json: { habitats: [{ id, name, dbPath, flavor }], activeId, onboarded }
let envMode = false;

function habitatsState() {
  if (envMode) {
    return { habitats: [{ id: 'env', name: 'Habitat', dbPath: currentDbPath, flavor: '' }], activeId: 'env', onboarded: true };
  }
  const cfg = loadConfig();
  return { habitats: cfg.habitats || [], activeId: cfg.activeId, onboarded: cfg.onboarded !== false };
}

app.whenReady().then(() => {
  try {
    boot();
  } catch (e) {
    dialog.showErrorBox(
      'Habitat could not start',
      `${e.message}\n\nIf another copy of Habitat is running, quit it and try again.\nVault: ${currentDbPath || 'unknown'}`
    );
    app.exit(1);
  }
});

function boot() {
  let dbPath;
  if (process.env.HABITAT_DB) {
    envMode = true;
    dbPath = process.env.HABITAT_DB;
  } else {
    const cfg = loadConfig();
    const known = Array.isArray(cfg.habitats) ? cfg.habitats.filter((h) => h && h.dbPath) : [];
    const alive = known.filter((h) => fs.existsSync(h.dbPath));

    if (alive.length === 0) {
      // Fresh install, or every known vault file is gone (e.g. deleted to retest onboarding) — start over.
      const legacyPath = (known[0] && known[0].dbPath) || cfg.dbPath || path.join(app.getPath('userData'), 'habitat.db');
      saveConfig({
        habitats: [{ id: 'default', name: 'My Habitat', dbPath: legacyPath, flavor: 'personal' }],
        activeId: 'default',
        onboarded: false,
      });
      dbPath = legacyPath;
      preOnboardDbPath = legacyPath;
    } else {
      if (alive.length !== known.length) {
        // Some configured vaults vanished — drop them instead of silently recreating at their old path.
        const activeStillAlive = alive.some((h) => h.id === cfg.activeId);
        saveConfig({ habitats: alive, activeId: activeStillAlive ? cfg.activeId : alive[0].id });
      }
      const fresh = loadConfig();
      const active = alive.find((h) => h.id === fresh.activeId) || alive[0];
      dbPath = active.dbPath;
    }
    if (!fs.existsSync(path.dirname(dbPath))) dbPath = path.join(app.getPath('userData'), 'habitat.db');
  }
  initDb(dbPath);
  currentDbPath = dbPath;

  for (const [channel, fn] of Object.entries(api)) {
    ipcMain.handle(channel, (_e, payload) => fn(payload));
  }

  // Automations can raise a system notification…
  setNotifier((title, body) => {
    if (!Notification.isSupported()) {
      console.warn('notifications are not available on this system');
      return;
    }
    try {
      new Notification({ title: title || 'Habitat', body: body || '', silent: false }).show();
    } catch (err) {
      console.error('notification failed', err);
    }
  });

  // …and message the user on Telegram, which also works when the Mac is asleep-adjacent
  // or the app is in the background.
  setTelegramSender((text) => {
    const cfg = api['telegram:get']();
    if (!cfg?.enabled || !cfg.token || !cfg.chatId) return;
    telegram.sendMessage(cfg, text).catch((err) => console.error('telegram send failed', err.message));
  });

  /** Pulls anything sent to the bot into the vault, and answers with a receipt. */
  async function pollTelegram() {
    const cfg = api['telegram:get']();
    if (!cfg?.enabled || !cfg.token) return;
    let updates = [];
    try {
      updates = await telegram.fetchUpdates(cfg, cfg.offset);
    } catch (err) {
      console.error('telegram poll failed', err.message);
      return;
    }
    if (!updates.length) return;
    let offset = cfg.offset || 0;
    let chatId = cfg.chatId;
    for (const u of updates) {
      offset = Math.max(offset, u.update_id);
      const msg = u.message;
      if (!msg) continue;
      // First message also teaches us which chat to reply to.
      if (!chatId) chatId = String(msg.chat?.id ?? '');
      if (chatId && String(msg.chat?.id) !== String(chatId)) continue;
      const text = msg.text || msg.caption || '';
      if (!text.trim()) continue;
      const made = api['telegram:ingest']({ text, typeId: cfg.typeId });
      if (made) {
        const receipt =
          made.kind === 'daily'
            ? `Added to today’s note: “${made.title}”`
            : `Saved “${made.title}” as ${made.typeName}`;
        telegram.sendMessage({ ...cfg, chatId }, receipt).catch((err) => console.error('telegram reply failed', err.message));
      }
    }
    api['telegram:save']({ offset, chatId });
  }

  /** The local HTTP API follows the vault: restarted whenever its settings change. */
  async function applyServer() {
    const cfg = api['api:config']();
    if (!cfg.enabled) {
      server.stop();
      return { ok: true, running: false };
    }
    const res = await server.start(api, cfg);
    return { ...res, running: res.ok };
  }

  // Clear anything the short-lived account experiment left behind.
  if (loadConfig().account) {
    const cfg = loadConfig();
    delete cfg.account;
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
  }

  applyServer();
  api['automations:appStart']();

  // ---------- updates ----------
  //
  // Unsigned builds can't use Squirrel, so the app fetches the newest GitHub
  // release itself and swaps its own bundle. See electron/updater.js.
  const REPO = (pkg.build?.publish?.[0] && `${pkg.build.publish[0].owner}/${pkg.build.publish[0].repo}`) || '';
  let updateState = { status: app.isPackaged ? 'idle' : 'dev', version: app.getVersion() };

  const pushUpdate = (patch) => {
    updateState = { ...updateState, ...patch };
    win?.webContents.send('update:state', updateState);
  };

  async function checkForUpdates({ download = true } = {}) {
    if (!app.isPackaged) return pushUpdate({ status: 'dev' });
    if (!REPO || REPO.startsWith('REPLACE_ME')) return pushUpdate({ status: 'error', error: 'No GitHub repo configured.' });
    try {
      pushUpdate({ status: 'checking', error: null });
      const release = await updater.latestRelease(REPO);
      const next = String(release.tag_name || '').replace(/^v/, '');
      if (!updater.isNewer(next, app.getVersion())) return pushUpdate({ status: 'current', next: null });

      pushUpdate({ status: 'available', next, notes: release.body || '', url: release.html_url });
      if (!download) return;

      // Only macOS can be swapped underneath a running process safely.
      if (process.platform !== 'darwin') return;
      const asset = updater.pickAsset(release);
      if (!asset) return pushUpdate({ status: 'available', next, error: 'That release has no zip for this platform.' });

      pushUpdate({ status: 'downloading', next });
      const zip = path.join(app.getPath('temp'), asset.name);
      await updater.download(asset.browser_download_url, zip);
      pushUpdate({ status: 'staged', next, zip });
    } catch (err) {
      pushUpdate({ status: 'error', error: String(err?.message || err) });
    }
  }

  ipcMain.handle('update:state', () => updateState);
  ipcMain.handle('update:check', async () => {
    await checkForUpdates();
    return updateState;
  });

  /** Replaces the installed bundle with the staged one and relaunches into it. */
  ipcMain.handle('update:install', async () => {
    if (updateState.status !== 'staged' || !updateState.zip) {
      if (updateState.url) shell.openExternal(updateState.url);
      return false;
    }
    const bundle = updater.bundlePath(app.getPath('exe'));
    if (!bundle) {
      pushUpdate({ status: 'error', error: 'Could not find the installed app bundle.' });
      return false;
    }
    try {
      pushUpdate({ status: 'installing' });
      await updater.installMac(updateState.zip, bundle);
      app.relaunch();
      app.exit(0);
      return true;
    } catch (err) {
      pushUpdate({ status: 'error', error: `Update failed: ${String(err?.message || err)}` });
      return false;
    }
  });

  checkForUpdates();
  setInterval(() => checkForUpdates(), 4 * 60 * 60 * 1000);

  ipcMain.handle('app:info', () => ({ appDir: path.resolve(__dirname, '..'), version: app.getVersion() }));
  ipcMain.handle('api:apply', () => applyServer());
  ipcMain.handle('api:status', () => server.status());



  ipcMain.handle('telegram:test', async () => {
    const cfg = api['telegram:get']();
    if (!cfg?.token) return { ok: false, error: 'Add your bot token first.' };
    try {
      const me = await telegram.whoAmI(cfg.token);
      api['telegram:save']({ botName: me.username });
      if (!cfg.chatId) return { ok: false, error: `Connected to @${me.username}. Now send it a message so it learns your chat.` };
      await telegram.sendMessage(cfg, 'Habitat is connected ✅');
      return { ok: true, bot: me.username };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('telegram:poll', () => pollTelegram());

  ipcMain.handle('automations:startup', () => {
    try {
      return api['automations:appStart']();
    } catch (err) {
      console.error('automation start failed', err);
      return { ran: 0 };
    }
  });

  // Timed automations only need minute resolution; the same tick collects
  // anything captured on the phone.
  setInterval(() => {
    try {
      api['automations:tick']();
    } catch (err) {
      console.error('automation tick failed', err);
    }
    pollTelegram();
  }, 60_000);

  pollTelegram();

  ipcMain.handle('window:trafficLights', (_e, visible) => {
    if (win && process.platform === 'darwin') win.setWindowButtonVisibility(!!visible);
    return true;
  });

  ipcMain.handle('settings:get', () => ({ dbPath: currentDbPath, ...habitatsState() }));

  ipcMain.handle('settings:chooseVault', async () => {
    const dir = await pickFolderDialog('Choose a vault folder');
    if (!dir) return null;
    const out = switchVault(dir);
    currentDbPath = out.dbPath;
    if (!envMode) {
      const cfg = loadConfig();
      const habitats = (cfg.habitats || []).map((h) => (h.id === cfg.activeId ? { ...h, dbPath: out.dbPath } : h));
      saveConfig({ habitats });
    }
    return out;
  });

  // mode 'vault': date-named files become daily notes, the rest become notes.
  // mode 'daily': every file is a daily note, with the date read from its name.
  ipcMain.handle('import:obsidianVault', async (_e, { mode } = {}) => {
    const daily = mode === 'daily';
    const dir = await pickFolderDialog(
      daily ? 'Choose your daily notes folder' : 'Choose your Obsidian vault',
      daily
        ? 'Every .md file here is imported as a daily note, dated from its filename.'
        : 'Every .md file in this folder and its subfolders is imported. Date-named files become daily notes.'
    );
    if (!dir) return null;

    const { dateKeyFromFilename } = require('./markdown');
    const entries = [];
    const undated = [];
    let folders = 0;

    const walk = (folder, depth) => {
      if (depth > 12) return;
      let items = [];
      try {
        items = fs.readdirSync(folder, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of items) {
        if (item.name.startsWith('.')) continue; // .obsidian, .trash, …
        const full = path.join(folder, item.name);
        if (item.isDirectory()) {
          folders++;
          walk(full, depth + 1);
        } else if (item.isFile() && /\.md$/i.test(item.name)) {
          const dateKey = dateKeyFromFilename(item.name, { anywhere: daily });
          if (daily && !dateKey) {
            undated.push(item.name);
            continue;
          }
          try {
            entries.push({
              dateKey,
              title: item.name.replace(/\.md$/i, ''),
              markdown: fs.readFileSync(full, 'utf8'),
            });
          } catch {
            /* unreadable file — skip it */
          }
        }
      }
    };
    walk(dir, 0);

    // Daily notes first and oldest-first, so the ordering is predictable.
    entries.sort((a, b) => {
      if (!!a.dateKey !== !!b.dateKey) return a.dateKey ? -1 : 1;
      return a.dateKey ? a.dateKey.localeCompare(b.dateKey) : a.title.localeCompare(b.title);
    });

    const result = api['import:vault']({ entries });
    return {
      ...result,
      scanned: entries.length + undated.length,
      folders,
      dir,
      undated: undated.length,
      undatedSample: undated.slice(0, 3),
    };
  });

  ipcMain.handle('settings:reveal', () => {
    shell.showItemInFolder(currentDbPath);
    return true;
  });

  ipcMain.handle('habitats:pickFolder', () =>
    pickFolderDialog('Choose a folder for this habitat', 'Habitat will create its own subfolder here, named after it.')
  );

  ipcMain.handle('habitats:create', (_e, { name, flavor, dir }) => {
    const id = randomUUID().replace(/-/g, '').slice(0, 10);
    const habitatName = String(name || '').trim();
    if (!habitatName) return { error: 'name-required' };
    const parent = dir || path.join(app.getPath('userData'), 'Habitats');
    // Each habitat gets its own folder, named after it, holding one same-named .db file.
    const file = makeHabitatFile(parent, habitatName);
    openVault(file);
    if (flavor === 'blank') resetToBlank();
    else seedFlavor(flavor);
    // Person and Tag exist in every habitat so @-mentions and #-tags always work.
    ensurePersonType();
    ensureTagType();
    currentDbPath = file;
    if (!envMode) {
      const cfg = loadConfig();
      saveConfig({
        habitats: [...(cfg.habitats || []), { id, name: habitatName, dbPath: file, flavor }],
        activeId: id,
        onboarded: true,
      });
    }
    return { id, dbPath: file };
  });

  ipcMain.handle('habitats:switch', (_e, { id }) => {
    const { habitats } = habitatsState();
    const target = habitats.find((h) => h.id === id);
    if (!target || !fs.existsSync(target.dbPath)) return null;
    openVault(target.dbPath);
    currentDbPath = target.dbPath;
    if (!envMode) saveConfig({ activeId: id });
    return { id, dbPath: target.dbPath };
  });

  ipcMain.handle('habitats:onboard', (_e, { name, flavor, userName, people, dir }) => {
    const habitatName = String(name || 'My Habitat').trim() || 'My Habitat';
    const parent = dir || path.join(app.getPath('userData'), 'Habitats');
    // Same folder-per-habitat convention as habitats:create, so the very first habitat
    // is laid out identically to every one added afterward.
    const file = makeHabitatFile(parent, habitatName);
    openVault(file);
    if (flavor === 'blank') resetToBlank();
    else seedFlavor(flavor);
    seedPeople(userName, people); // also ensures the Person type
    ensureTagType();
    currentDbPath = file;
    if (!envMode) {
      const cfg = loadConfig();
      const habitats = (cfg.habitats || []).map((h) =>
        h.id === cfg.activeId ? { ...h, name: habitatName, flavor, dbPath: file } : h
      );
      saveConfig({ habitats, onboarded: true });
    }
    // The pre-onboarding stub boot() created is now dead weight — the real habitat lives elsewhere.
    if (preOnboardDbPath && path.resolve(preOnboardDbPath) !== path.resolve(currentDbPath)) {
      removeVaultFiles(preOnboardDbPath);
      preOnboardDbPath = null;
    }
    return true;
  });

  ipcMain.handle('habitats:delete', (_e, { id }) => {
    if (envMode) return { ok: false };
    const cfg = loadConfig();
    const habitats = cfg.habitats || [];
    const target = habitats.find((h) => h.id === id);
    if (!target) return { ok: false };

    const remaining = habitats.filter((h) => h.id !== id);
    const wasActive = cfg.activeId === id;

    if (remaining.length > 0) {
      const nextActive = wasActive ? remaining[0] : habitats.find((h) => h.id === cfg.activeId) || remaining[0];
      if (wasActive) {
        openVault(nextActive.dbPath); // closes the vault being deleted before we touch its files
        currentDbPath = nextActive.dbPath;
      }
      removeVaultFiles(target.dbPath);
      saveConfig({ habitats: remaining, activeId: nextActive.id, onboarded: true });
      return { ok: true, onboarding: false, activeId: nextActive.id };
    }

    // Deleting the last habitat: wipe it, then drop back to onboarding.
    closeDb();
    removeVaultFiles(target.dbPath);
    const freshPath = path.join(app.getPath('userData'), 'habitat.db');
    initDb(freshPath);
    currentDbPath = freshPath;
    preOnboardDbPath = freshPath; // cleaned up once the next onboarding relocates it
    saveConfig({ habitats: [], activeId: null, onboarded: false });
    return { ok: true, onboarding: true };
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.on('before-quit', () => server.stop());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || process.env.HABITAT_SHOT) app.quit();
});

// Checkpoint WAL into the main file and close cleanly so no -wal/-shm files linger after quitting —
// otherwise they're only merged away the next time this habitat is opened or switched away from.
app.on('before-quit', () => closeDb());
