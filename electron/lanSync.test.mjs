// Peer-to-peer LAN sync over HTTP: initial snapshot clone and incremental delta sync.
// Uses a Worker thread for the Laptop server so both devices have isolated SQLite instances.
// Run with `node --test electron/lanSync.test.mjs`.

import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const require = createRequire(import.meta.url);

if (!isMainThread) {
  // Laptop worker process
  const dbmod = require('./db.js');
  const server = require('./server.js');

  dbmod.initDb(workerData.dbPath);
  dbmod.seedFlavor('work');

  // Seed note and image on laptop
  dbmod.api['objects:create']({ typeId: 'note', title: 'Seed note from laptop' });
  const fileBytes = Buffer.from('fake image content for testing');
  dbmod.api['files:add']({ name: 'test.png', mime: 'image/png', data: fileBytes });

  const cfg = dbmod.api['api:save']({ enabled: true, port: workerData.port, token: workerData.token, lan: true });
  server.start(dbmod.api, cfg).then((res) => {
    parentPort.postMessage({ type: 'ready', ok: res.ok, error: res.error });
  });

  parentPort.on('message', (msg) => {
    if (msg.cmd === 'createTask') {
      const task = dbmod.api['objects:create']({ typeId: 'task', title: msg.title });
      parentPort.postMessage({ type: 'taskCreated', taskId: task.id });
    } else if (msg.cmd === 'get') {
      const found = dbmod.api['objects:get'](msg.id);
      parentPort.postMessage({ type: 'got', found });
    } else if (msg.cmd === 'stop') {
      server.stop();
      dbmod.closeDb();
      parentPort.postMessage({ type: 'stopped' });
    }
  });
} else {
  // Test thread: acts as Phone
  const dbmod = require('./db.js');
  const { createSync, createLanTransport } = require('./sync.js');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-lan-sync-'));
  const LAPTOP = path.join(tmp, 'laptop', 'habitat.db');
  const PHONE = path.join(tmp, 'phone', 'habitat.db');
  const PORT = 37376;
  const TOKEN = 'test-lan-sync-token';

  let worker = null;
  let transport = null;

  function askLaptop(cmd, payload = {}) {
    return new Promise((resolve) => {
      const handler = (msg) => {
        worker.off('message', handler);
        resolve(msg);
      };
      worker.on('message', handler);
      worker.postMessage({ cmd, ...payload });
    });
  }

  before(async () => {
    // 1. Start Laptop in worker thread
    fs.mkdirSync(path.dirname(LAPTOP), { recursive: true });
    worker = new Worker(new URL(import.meta.url), {
      workerData: { dbPath: LAPTOP, port: PORT, token: TOKEN },
    });

    const ready = await new Promise((resolve) => {
      worker.on('message', (msg) => {
        if (msg.type === 'ready') resolve(msg);
      });
    });
    assert.ok(ready.ok, ready.error);

    // 2. Initialize fresh phone vault
    dbmod.initDb(PHONE);

    // 3. Create LAN transport pointing to the laptop server
    transport = createLanTransport({ baseUrl: `http://127.0.0.1:${PORT}`, token: TOKEN });
  });

  after(async () => {
    await askLaptop('stop');
    await worker.terminate();
    dbmod.closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('it connects and returns server sync info', async () => {
    const info = await transport.info();
    assert.equal(info.ok, true);
    assert.equal(info.app, 'habitat');
    assert.ok(info.deviceId);
  });

  test('initial clone: phone downloads snapshot and becomes exact replica of laptop', async () => {
    // Download snapshot from laptop
    const snapshot = await transport.snapshot();
    assert.ok(snapshot.tables);
    assert.ok(snapshot.tables.types.length > 0);
    assert.ok(snapshot.tables.objects.length > 0);

    // Apply snapshot to phone vault
    dbmod.sync.applySnapshot(snapshot);

    const phoneObjects = dbmod.api['objects:list']();
    assert.ok(phoneObjects.some((o) => o.title === 'Seed note from laptop'), 'phone should have the laptop note');
    assert.equal(dbmod.sync.pendingCount(), 0, 'snapshot restore should not queue cloned rows as edits');
  });

  test('delta sync: phone creates note offline, connects and pushes to laptop', async () => {
    const phoneSync = createSync({ store: dbmod.sync, transport });
    const created = dbmod.api['objects:create']({ typeId: 'note', title: 'Captured on phone while walking' });
    assert.ok(dbmod.sync.pendingCount() > 0, 'phone should have a pending change');

    // Phone syncs with laptop
    const syncRes = await phoneSync.run();
    assert.equal(syncRes.status, 'idle');
    assert.equal(syncRes.pending, 0, 'queue should drain after push');

    // Ask laptop if it received the note
    const { found } = await askLaptop('get', { id: created.id });
    assert.ok(found, 'laptop should have received the note from phone');
    assert.equal(found.title, 'Captured on phone while walking');
  });

  test('delta sync: laptop creates task, phone pulls it over LAN', async () => {
    // Laptop creates task
    const { taskId } = await askLaptop('createTask', { title: 'Buy milk tomorrow' });
    assert.ok(taskId);

    // Phone runs sync
    const phoneSync = createSync({ store: dbmod.sync, transport });
    await phoneSync.run();

    const foundOnPhone = dbmod.api['objects:get'](taskId);
    assert.ok(foundOnPhone, 'phone should have pulled the task from laptop');
    assert.equal(foundOnPhone.title, 'Buy milk tomorrow');
  });

  test('attachments: phone downloaded image blob from laptop, and can upload new phone images', async () => {
    // 1. Verify the initial seed image was already downloaded by sync
    const stats = dbmod.api['files:stats']();
    assert.equal(stats.count, 1, 'phone has 1 file recorded');
    const missing = dbmod.sync.blobsMissing();
    assert.equal(missing.length, 0, 'all missing blobs should already be downloaded');

    // 2. Add an image on phone while outside
    const phonePhotoBytes = Buffer.from('photo captured on phone outside');
    const added = dbmod.api['files:add']({ name: 'phone.jpg', mime: 'image/jpeg', data: phonePhotoBytes });
    assert.ok(added.hash);

    // 3. Phone syncs with laptop
    const phoneSync = createSync({ store: dbmod.sync, transport });
    await phoneSync.run();

    // Verify phone marked blob as uploaded
    const toUpload = dbmod.sync.blobsToUpload();
    assert.equal(toUpload.length, 0, 'phone photo should be marked uploaded');
  });
}
