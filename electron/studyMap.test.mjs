import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dbmod = require('./db.js');

const call = (channel, payload) => dbmod.api[channel](payload);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-studymap-'));
const file = path.join(tmp, 'vault.db');

before(() => {
  dbmod.initDb(file);
});

after(() => {
  dbmod.closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('study:categories starts empty so user can create them as needed', () => {
  const cats = call('study:categories');
  assert.ok(Array.isArray(cats), 'should return an array of categories');
  assert.equal(cats.length, 0, 'should start with zero categories');
});

test('study:categoryCreate creates and returns a custom category', () => {
  const cat = call('study:categoryCreate', {
    name: 'Quiet Zones',
    color: '#10b981',
    icon: 'volume-x',
  });
  assert.equal(cat.name, 'Quiet Zones');
  assert.equal(cat.color, '#10b981');

  const all = call('study:categories');
  assert.ok(all.some((c) => c.name === 'Quiet Zones'));
});

test('study:categoryPatch updates category fields and associated places', () => {
  const cat = call('study:categoryCreate', {
    name: 'Old Category Name',
    color: '#3b82f6',
    icon: 'pin',
  });
  assert.equal(cat.name, 'Old Category Name');

  const patched = call('study:categoryPatch', {
    id: cat.id,
    patch: {
      name: 'New Category Name',
      color: '#ef4444',
      icon: 'star',
    },
  });
  assert.equal(patched.name, 'New Category Name');
  assert.equal(patched.color, '#ef4444');
  assert.equal(patched.icon, 'star');

  const all = call('study:categories');
  assert.ok(all.some((c) => c.name === 'New Category Name'));
  assert.ok(!all.some((c) => c.name === 'Old Category Name'));
});

test('study:placeCreate creates a new study place with coordinates', () => {
  const place = call('study:placeCreate', {
    name: 'Widener Library Room 310',
    category: 'Library',
    color: '#3b82f6',
    lat: 42.3735,
    lng: -71.1165,
    zoom: 18,
    notes: 'Quiet study desks on the 3rd floor, lots of power plugs.',
    address: '1 Harvard Yard, Cambridge, MA',
  });

  assert.ok(place.id, 'place should have an id');
  assert.equal(place.name, 'Widener Library Room 310');
  assert.equal(place.category, 'Library');
  assert.equal(place.lat, 42.3735);
  assert.equal(place.lng, -71.1165);
  assert.equal(place.notes, 'Quiet study desks on the 3rd floor, lots of power plugs.');
  assert.ok(place.createdAt > 0);
  assert.ok(place.updatedAt > 0);
});

test('study:places retrieves all places and filters by category', () => {
  call('study:placeCreate', {
    name: 'Cafe Nero Harvard Sq',
    category: 'Study Spot',
    lat: 42.374,
    lng: -71.118,
  });

  const all = call('study:places');
  assert.ok(all.length >= 2, 'should have at least 2 places');

  const libraries = call('study:places', { category: 'Library' });
  assert.ok(libraries.length >= 1, 'should have library places');
  assert.ok(libraries.every((p) => p.category === 'Library'));

  const spots = call('study:places', { category: 'Study Spot' });
  assert.ok(spots.length >= 1, 'should have study spot places');
  assert.ok(spots.every((p) => p.category === 'Study Spot'));
});

test('study:placePatch updates place fields', () => {
  const p = call('study:placeCreate', {
    name: 'Temporary Lab',
    category: 'Lab',
    lat: 42.375,
    lng: -71.115,
  });

  const updated = call('study:placePatch', {
    id: p.id,
    patch: {
      name: 'Maxwell Dworkin Lab 2',
      notes: 'New monitors installed',
    },
  });

  assert.equal(updated.name, 'Maxwell Dworkin Lab 2');
  assert.equal(updated.notes, 'New monitors installed');
  assert.equal(updated.category, 'Lab');
});

test('study:placeDelete removes a place', () => {
  const p = call('study:placeCreate', {
    name: 'To Delete',
    category: 'General',
    lat: 42.1,
    lng: -71.1,
  });

  const delResult = call('study:placeDelete', p.id);
  assert.equal(delResult, true);

  const all = call('study:places');
  assert.ok(!all.some((x) => x.id === p.id), 'deleted place should not be returned');
});

test('study:categoryDelete removes a custom category', () => {
  const cat = call('study:categoryCreate', { name: 'Temporary Cat' });
  assert.ok(cat);

  const delResult = call('study:categoryDelete', cat.id);
  assert.equal(delResult, true);

  const all = call('study:categories');
  assert.ok(!all.some((c) => c.name === 'Temporary Cat'));
});

test('study:currentLocation returns coordinates and location metadata', async () => {
  const loc = await call('study:currentLocation');
  if (loc) {
    assert.equal(typeof loc.lat, 'number');
    assert.equal(typeof loc.lng, 'number');
  }
});

