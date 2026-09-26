import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dbmod = require('./db.js');
const files = require('./files.js');

const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-size-test-'));
const file = path.join(vault, 'test.db');
const api = dbmod.api;

const bytes = (s) => new TextEncoder().encode(s);
const add = (name, mime, body) => api['files:add']({ name, mime, data: bytes(body) });

before(() => {
  dbmod.initDb(file);
  dbmod.seedFlavor('personal');
});

after(() => {
  dbmod.closeDb();
  fs.rmSync(vault, { recursive: true, force: true });
});

test('habitat:size reports database size, files size and counts', () => {
  const initial = api['habitat:size']();
  assert.equal(initial.dbPath, file);
  assert.ok(initial.dbBytes > 0, 'database file size should be greater than 0');
  assert.equal(initial.objectsCount, 0, 'no objects initially');
  assert.equal(initial.filesCount, 0, 'no attachments yet');
  assert.equal(initial.filesBytes, 0, 'no attachment bytes yet');
  assert.equal(initial.totalBytes, initial.dbBytes, 'total equals database size when no files');

  // Add an attachment
  const ref = add('photo.jpg', 'image/jpeg', 'pretend-image-bytes-with-some-length');
  const withFile = api['habitat:size']();
  assert.equal(withFile.filesCount, 1);
  assert.ok(withFile.filesBytes > 0);
  assert.equal(withFile.totalBytes, withFile.dbBytes + withFile.filesBytes);

  // Add an object
  api['objects:create']({ typeId: 'note', title: 'New note for size test' });
  const withNote = api['habitat:size']();
  assert.equal(withNote.objectsCount, 1);
});
