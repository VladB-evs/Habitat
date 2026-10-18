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
  assert.equal(step.title, 'Extra Step');

  const updatedStep = api['goals:stepUpdate']({ id: step.id, title: 'Edited Extra Step' });
  assert.equal(updatedStep.title, 'Edited Extra Step');

  api['goals:delete'](g.id);
  assert.equal(api['goals:get'](g.id), null);
});

test('goals: North Star goal cannot be duplicated or replaced', () => {
  const g1 = api['goals:create']({
    title: 'North Star #1',
    isNorthStar: true,
  });
  assert.equal(g1.isNorthStar, true);

  const list1 = api['goals:list']();
  const found1 = list1.find((item) => item.id === g1.id);
  assert.equal(found1?.isNorthStar, true);

  // Trying to create a second North Star must fail
  assert.throws(() => {
    api['goals:create']({
      title: 'North Star #2',
      isNorthStar: true,
    });
  }, /already exists/);

  // Creating a normal goal works fine
  const normal = api['goals:create']({
    title: 'Normal Goal',
    isNorthStar: false,
  });
  assert.equal(normal.isNorthStar, false);

  // Trying to promote the normal goal to North Star while g1 exists must fail
  assert.throws(() => {
    api['goals:patch']({
      id: normal.id,
      patch: { isNorthStar: true },
    });
  }, /already exists/);

  // Editing g1 itself without changing isNorthStar works fine
  const updatedG1 = api['goals:patch']({
    id: g1.id,
    patch: { title: 'North Star Updated' },
  });
  assert.equal(updatedG1.isNorthStar, true);
  assert.equal(updatedG1.title, 'North Star Updated');
});


