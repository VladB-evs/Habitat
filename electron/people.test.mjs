// The People type has two rules the rest of the app can't see: the self card is
// its own entity — made once, never handed over, and without the properties
// that describe a link to someone else — and relationship is a multi-select, so
// a friend can also be a colleague. Both have to survive old vaults, which is
// what the migration test is for. Run with `npm test`.

import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dbmod = require('./db.js');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-people-'));
const file = path.join(dir, 'test.db');
const api = dbmod.api;

const relDef = () => api['types:list']().find((t) => t.id === 'people').properties.find((p) => p.id === 'relationship');

before(() => dbmod.initDb(file));

after(() => {
  dbmod.closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('relationship is a multi-select of several hats', () => {
  const def = relDef();
  assert.equal(def.kind, 'multiselect');
  for (const o of ['Colleague', 'Friend', 'Mentor', 'Sibling']) assert.ok(def.options.includes(o), `${o} is offered`);

  const made = api['people:create']({ title: 'Nadia', props: { relationship: ['Colleague', 'Close friend'] } });
  assert.deepEqual(api['people:get'](made.id).props.relationship, ['Colleague', 'Close friend']);
});

test('the self card is its own entity, without a relationship to itself', () => {
  const me = api['people:create']({ title: 'Vlad', self: true, props: { relationship: ['Friend'], email: 'v@example.com' } });
  assert.equal(me.isSelf, true);
  assert.equal(me.props.relationship, undefined, 'not even when asked for at creation');
  assert.equal(me.props.email, 'v@example.com', 'everything else is kept');
  assert.equal(api['people:self']().id, me.id);

  // Whoever writes it — the app, the HTTP API, an agent — it does not stick.
  api['objects:update']({ id: me.id, patch: { props: { ...me.props, relationship: ['Family'], phone: '123' } } });
  const after = api['people:get'](me.id);
  assert.equal(after.props.relationship, undefined);
  assert.equal(after.props.phone, '123');
});

test('the self card cannot be handed to someone else', () => {
  const me = api['people:self']();
  assert.equal(api['people:setSelf'], undefined, 'there is no way to reassign it');

  const other = api['people:create']({ title: 'Someone else', self: true });
  assert.equal(other.isSelf, false);
  assert.equal(api['people:self']().id, me.id, 'still me');

  // Deleting the card is the way out: the pointer clears and a new one can be made.
  api['objects:delete'](me.id);
  assert.equal(api['people:self'](), null);
  const fresh = api['people:create']({ title: 'Vlad again', self: true });
  assert.equal(fresh.isSelf, true);
});

test('old vaults: single relationships become lists, the self card loses its own', () => {
  const me = api['people:self']();
  const friend = api['people:create']({ title: 'Otto' });
  const both = api['people:create']({ title: 'Ines', props: { relationship: ['Colleague', 'Friend'] } });
  dbmod.closeDb();

  // Rewind to how the vault looked before: a single-choice property, single values.
  const raw = new DatabaseSync(file);
  const old = [
    { id: 'nickname', name: 'Nickname', kind: 'text' },
    { id: 'relationship', name: 'Relationship', kind: 'select', options: ['Family', 'Friend', 'Skydiving buddy'] },
    { id: 'birthday', name: 'Birthday', kind: 'date' },
  ];
  raw.prepare('UPDATE types SET properties = ? WHERE id = ?').run(JSON.stringify(old), 'people');
  const setProps = raw.prepare('UPDATE objects SET props = ? WHERE id = ?');
  setProps.run(JSON.stringify({ relationship: 'Friend', phone: '99' }), friend.id);
  setProps.run(JSON.stringify({ relationship: 'Family' }), me.id);
  raw.prepare("DELETE FROM kv WHERE key = 'migration:people-relationships-v2'").run();
  raw.close();

  dbmod.initDb(file);

  const def = relDef();
  assert.equal(def.kind, 'multiselect');
  assert.ok(def.options.includes('Skydiving buddy'), 'an option added by hand is kept');
  assert.ok(def.options.includes('Mentee'), 'alongside the new ones');

  assert.deepEqual(api['people:get'](friend.id).props.relationship, ['Friend']);
  assert.equal(api['people:get'](friend.id).props.phone, '99', 'the rest of the card is untouched');
  assert.deepEqual(api['people:get'](both.id).props.relationship, ['Colleague', 'Friend'], 'lists are left alone');
  assert.equal(api['people:get'](me.id).props.relationship, undefined, 'me and me is not a relationship');
});
