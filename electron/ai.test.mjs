// The on-device model itself can't be asserted on — it's a language model, and
// its wording changes run to run. What can be pinned down is everything around
// it: that prompts stay in the main process, that oversized work is refused
// before a process is even spawned, and that the sidecar speaks the protocol
// electron/ai.js expects. Run with `npm test`.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const actions = require('./aiActions.js');
const ai = require('./ai.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const sidecar = [
  path.join(here, '..', 'native', 'habitat-ai'),
  path.join(here, '..', 'swift', '.build', 'release', 'habitat-ai'),
].find((p) => existsSync(p));

test('the catalogue the toolbar sees carries no prompts', () => {
  const list = actions.list();
  assert.ok(list.length > 0);
  for (const item of list) {
    assert.deepEqual(Object.keys(item).sort(), ['appends', 'icon', 'id', 'label']);
  }
});

test('every advertised action can actually be built', () => {
  for (const { id } of actions.list()) {
    const req = actions.build(id, 'the quick brown fox');
    assert.ok(req, `${id} builds`);
    assert.ok(req.prompt.includes('the quick brown fox'), `${id} passes the text through`);
    assert.ok(req.instructions.length > 0, `${id} has instructions`);
  }
});

test('an unknown action is refused rather than guessed at', () => {
  assert.equal(actions.build('summarise-in-latin', 'hello'), null);
});

test('instructions tell the model not to preface its answer', () => {
  // The small on-device model volunteers "Sure! Here you go:" unless told not
  // to, and that text would land straight in the document.
  for (const action of actions.ACTIONS) {
    assert.match(action.instructions, /only/i, `${action.id} says "only"`);
  }
});

test('too much text is refused without spawning anything', async () => {
  const long = 'x'.repeat(ai.MAX_PROMPT_CHARS + 1);
  await assert.rejects(
    () => ai.run({ id: 'test', instructions: 'hi', prompt: long }),
    /more text than the on-device model can hold/
  );
});

test('cancelling a run that was never started says so', () => {
  assert.equal(ai.cancel('never-started'), false);
});

/* ---------- plain English into the search bar's syntax ---------- */

const TYPES = [{ name: 'Note' }, { name: 'Task' }, { name: 'Book' }];
const TAGS = [{ title: 'work' }, { title: 'health' }];

test('the schema is built from the vault, so nothing can be invented', () => {
  const { schema } = actions.searchRequest({ text: 'anything', types: TYPES, tags: TAGS });
  const field = (name) => schema.properties.find((p) => p.name === name);
  assert.deepEqual(field('type').values, ['note', 'task', 'book']);
  assert.deepEqual(field('tag').values, ['work', 'health']);
  // Every filter is optional: a request that names none is still a valid answer.
  assert.ok(schema.properties.every((p) => p.optional));
});

test('filters are decided before the words to match', () => {
  // Guided generation fills fields in order. With `words` first the model
  // commits to "tasks" as text before it considers setting the type.
  const { schema } = actions.searchRequest({ text: 'anything', types: TYPES, tags: TAGS });
  const names = schema.properties.map((p) => p.name);
  assert.equal(names[names.length - 1], 'words');
  assert.ok(names.indexOf('type') < names.indexOf('words'));
});

test('a vault with no types or tags simply offers neither', () => {
  const { schema } = actions.searchRequest({ text: 'anything', types: [], tags: [] });
  const names = schema.properties.map((p) => p.name);
  assert.ok(!names.includes('type'));
  assert.ok(!names.includes('tag'));
  assert.ok(names.includes('words'));
});

test('the tag list is capped so it cannot fill the context window', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ title: 'tag' + i }));
  const { schema } = actions.searchRequest({ text: 'anything', types: TYPES, tags: many });
  assert.equal(schema.properties.find((p) => p.name === 'tag').values.length, 40);
});

test('the model\'s JSON becomes the query a person could have typed', () => {
  const query = actions.searchQuery(
    { type: 'task', tag: 'work', due: 'week', pinned: true, words: 'calendar' },
    { types: TYPES, tags: TAGS }
  );
  assert.equal(query, 'type:task tag:work due:week is:pinned calendar');
});

test('words that only restate a filter are dropped', () => {
  // Left in, "tasks" and "overdue" would have to match as literal text, and the
  // search would come back empty for a request the filters already answered.
  const query = actions.searchQuery({ type: 'task', due: 'overdue', words: 'tasks overdue dentist' }, { types: TYPES });
  assert.equal(query, 'type:task due:overdue dentist');
});

test('a type or tag the vault does not have is discarded, not passed on', () => {
  const query = actions.searchQuery({ type: 'invoice', tag: 'nonsense', words: 'coffee' }, { types: TYPES, tags: TAGS });
  assert.equal(query, 'coffee');
});

test('made-up window values are refused', () => {
  const query = actions.searchQuery({ due: 'next fortnight', edited: 'week' }, { types: TYPES });
  assert.equal(query, 'edited:week');
});

test('pinned only counts when it is true', () => {
  assert.equal(actions.searchQuery({ pinned: false, words: 'x' }, {}), 'x');
  assert.equal(actions.searchQuery({ pinned: true }, {}), 'is:pinned');
});

test('an empty result yields an empty query rather than a broken one', () => {
  assert.equal(actions.searchQuery({}, { types: TYPES }), '');
});

test('a multi-word type comes back as its id, not as a broken operator', () => {
  // The query bar splits on spaces, so `type:daily note` would parse as the type
  // `daily` plus a stray word "note" that then has to match as text.
  const types = [{ id: 'daily', name: 'Daily Note' }];
  assert.equal(actions.searchQuery({ type: 'daily note', words: 'coffee' }, { types }), 'type:daily coffee');
});

test('a type whose name leaked into the words is cleaned up either way', () => {
  const types = [{ id: 'daily', name: 'Daily Note' }];
  assert.equal(actions.searchQuery({ type: 'daily note', words: 'note daily coffee' }, { types }), 'type:daily coffee');
});

test('tags that cannot be written are never offered', () => {
  // `tag:reading list` would read as a tag plus a loose word, so the model is
  // never given the chance to choose one.
  const { schema } = actions.searchRequest({
    text: 'anything',
    types: TYPES,
    tags: [{ title: 'work' }, { title: 'reading list' }],
  });
  assert.deepEqual(schema.properties.find((p) => p.name === 'tag').values, ['work']);
});

// The rest needs the Swift binary. It's built by `npm run build:ai`, and absent
// on a machine that can't build it — which is a valid state, not a failure.
test('the sidecar answers on the protocol ai.js speaks', { skip: !sidecar }, async () => {
  const child = spawn(sidecar, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = [];

  const done = new Promise((resolve) => {
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) lines.push(JSON.parse(line));
      }
      if (lines.length >= 2) resolve();
    });
  });

  child.stdin.write(JSON.stringify({ id: 'a', op: 'availability' }) + '\n');
  child.stdin.write(JSON.stringify({ id: 'b', op: 'nonsense' }) + '\n');
  await done;
  child.stdin.end();

  const availability = lines.find((l) => l.id === 'a');
  assert.equal(availability.event, 'result');
  assert.equal(typeof availability.available, 'boolean');
  // Unavailable is fine — unexplained is not, since the app shows the reason.
  if (!availability.available) assert.equal(typeof availability.reason, 'string');

  const unknown = lines.find((l) => l.id === 'b');
  assert.equal(unknown.event, 'error');
  assert.equal(unknown.code, 'bad-request');
});

test('the sidecar streams a reply and reports it whole', { skip: !sidecar }, async () => {
  const child = spawn(sidecar, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  const events = [];

  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the model did not answer in time')), 60_000);
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        events.push(msg);
        if (msg.event === 'done' || msg.event === 'error') {
          clearTimeout(timer);
          resolve(msg);
        }
      }
    });
  });

  child.stdin.write(JSON.stringify({ id: 'a', op: 'availability' }) + '\n');
  child.stdin.write(
    JSON.stringify({ ...actions.build('fix', 'i has two apple'), id: 'r', op: 'run' }) + '\n'
  );

  const last = await finished;
  child.stdin.end();

  if (events[0]?.available === false) return; // no Apple Intelligence here
  assert.equal(last.event, 'done', last.message);

  // The deltas must reassemble into exactly what `done` reports, or the editor
  // would show one thing while inserting another.
  const streamed = events
    .filter((e) => e.id === 'r' && (e.event === 'delta' || e.event === 'reset'))
    .reduce((acc, e) => (e.event === 'reset' ? e.text : acc + e.text), '');
  assert.equal(streamed, last.text);
  assert.ok(last.text.trim().length > 0);
});

test('the sidecar answers a schema with JSON that fits it', { skip: !sidecar }, async () => {
  const child = spawn(sidecar, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  const events = [];

  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the model did not answer in time')), 60_000);
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        events.push(msg);
        if (msg.id === 'q' && (msg.event === 'done' || msg.event === 'error')) {
          clearTimeout(timer);
          resolve(msg);
        }
      }
    });
  });

  child.stdin.write(JSON.stringify({ id: 'a', op: 'availability' }) + '\n');
  const request = actions.searchRequest({
    text: 'tasks about the calendar due this week',
    types: TYPES,
    tags: TAGS,
  });
  child.stdin.write(JSON.stringify({ ...request, id: 'q', op: 'run' }) + '\n');

  const last = await finished;
  child.stdin.end();

  if (events[0]?.available === false) return; // no Apple Intelligence here
  assert.equal(last.event, 'done', last.message);
  // Structured replies arrive whole; a half-built object would be no use.
  assert.equal(last.structured, true);
  assert.ok(!events.some((e) => e.id === 'q' && e.event === 'delta'));

  const parsed = JSON.parse(last.text);
  const allowed = new Set(request.schema.properties.map((p) => p.name));
  for (const key of Object.keys(parsed)) assert.ok(allowed.has(key), `${key} is a field we asked for`);
  // The enums are the point: the model cannot name a type this vault lacks.
  if (parsed.type) assert.ok(['note', 'task', 'book'].includes(parsed.type));
  if (parsed.tag) assert.ok(['work', 'health'].includes(parsed.tag));
  // And it all has to survive the trip back into the search bar's own syntax.
  assert.equal(typeof actions.searchQuery(parsed, { types: TYPES, tags: TAGS }), 'string');
});

test('a schema the sidecar cannot build is refused, not crashed on', { skip: !sidecar }, async () => {
  const child = spawn(sidecar, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  const reply = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no answer')), 30_000);
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      clearTimeout(timer);
      resolve(JSON.parse(buffer.slice(0, nl)));
    });
  });

  child.stdin.write(
    JSON.stringify({
      id: 'bad',
      op: 'run',
      prompt: 'anything',
      schema: { name: 'Broken', type: 'object', properties: [{ name: 'kind', type: 'enum', values: [] }] },
    }) + '\n'
  );

  const msg = await reply;
  child.stdin.end();
  assert.equal(msg.event, 'error');
  assert.equal(msg.code, 'bad-request');
  assert.match(msg.message, /schema/i);
});
