import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dbmod = require('./db.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-goals-'));
const file = path.join(tmp, 'goals.db');
const api = dbmod.api;

before(() => {
  dbmod.initDb(file);
});

after(() => {
  dbmod.closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('goals:create and goals:list manage aspirations and steps', () => {
  const g = api['goals:create']({
    title: 'Run a marathon',
    description: '42.195 km target',
    category: 'Health',
    targetDate: '2026-12-01',
    steps: ['Buy running shoes', 'Run 5km', 'Run 21km'],
  });

  assert.ok(g.id);
  assert.equal(g.title, 'Run a marathon');
  assert.equal(g.category, 'Health');
  assert.equal(g.completed, false);
  assert.equal(g.steps.length, 3);
  assert.equal(g.steps[0].title, 'Buy running shoes');

  const list = api['goals:list']();
  assert.ok(list.length >= 1);
  const found = list.find((item) => item.id === g.id);
  assert.ok(found);
  assert.equal(found.steps.length, 3);
});

test('goals:stepToggle updates step completion and auto-completes goal when all done', () => {
  const g = api['goals:create']({
    title: 'Learn Guitar',
    category: 'Creative',
    steps: ['Learn chords', 'Play first song'],
  });

  assert.equal(g.completed, false);
  const step1 = g.steps[0];
  const step2 = g.steps[1];

  const toggled1 = api['goals:stepToggle']({ id: step1.id });
  assert.equal(toggled1.completed, true);

  let cur = api['goals:get'](g.id);
  assert.equal(cur.completed, false);

  const toggled2 = api['goals:stepToggle']({ id: step2.id });
  assert.equal(toggled2.completed, true);

  cur = api['goals:get'](g.id);
  assert.equal(cur.completed, true, 'goal automatically completes when all milestones are done');
  assert.ok(cur.completedAt > 0);
});

test('goals:patch and goals:delete work cleanly', () => {
  const g = api['goals:create']({
    title: 'Temporary Goal',
    category: 'Personal',
  });

  const updated = api['goals:patch']({
    id: g.id,
    patch: { title: 'Renamed Goal', color: '#3498db' },
  });
  assert.equal(updated.title, 'Renamed Goal');
  assert.equal(updated.color, '#3498db');

  const step = api['goals:stepAdd']({ goalId: g.id, title: 'Extra Step' });
  assert.ok(step.id);

  api['goals:delete'](g.id);
  assert.equal(api['goals:get'](g.id), null);
});
