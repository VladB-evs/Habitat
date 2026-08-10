// The reliability of "ask my notes" is almost entirely in the retrieval, not in
// the model: which day "two days ago" means, and which notes get read. Both are
// worked out in code precisely so they can be asserted on here. Run with `npm test`.

import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const ask = require('./ask.js');

// A Saturday, so weekday arithmetic has something to be wrong about.
const TODAY = '2026-08-08';
const on = (q) => ask.extractDates(q, TODAY);

/* ---------- which day ---------- */

test('the obvious relative days', () => {
  assert.equal(on('what did I do today')?.from, '2026-08-08');
  assert.equal(on('summarise yesterday')?.from, '2026-08-07');
  assert.equal(on('anything for tomorrow')?.from, '2026-08-09');
});

test('"the day before yesterday" is not read as "yesterday"', () => {
  // Both phrases contain the word, so the longer one has to be tried first.
  assert.equal(on('what happened the day before yesterday')?.from, '2026-08-06');
  assert.equal(on('the day after tomorrow')?.from, '2026-08-10');
});

test('counting back, in digits or in words', () => {
  assert.equal(on('summarize my daily note two days ago')?.from, '2026-08-06');
  assert.equal(on('summarize my daily note 2 days ago')?.from, '2026-08-06');
  assert.equal(on('what did I write 10 days ago')?.from, '2026-07-29');
});

test('a week or a month back is a span, not a single day', () => {
  // Nobody asking about "two weeks ago" means the one date exactly 14 days back.
  const weeks = on('what was I doing two weeks ago');
  assert.deepEqual([weeks.from, weeks.to], ['2026-07-25', '2026-08-01']);
  const month = on('anything from last month');
  assert.deepEqual([month.from, month.to], ['2026-07-09', '2026-08-08']);
});

test('a named weekday is the one just gone, never the one coming', () => {
  // From Saturday the 8th, "last Thursday" is the 6th — not the 13th.
  assert.equal(on('what did I do last thursday')?.from, '2026-08-06');
  assert.equal(on('my notes on monday')?.from, '2026-08-03');
  // The same weekday as today means a week ago, not today.
  assert.equal(on('last saturday')?.from, '2026-08-01');
});

test('an explicit date, written either way round', () => {
  assert.equal(on('what did I do on the 5th of August')?.from, '2026-08-05');
  assert.equal(on('what did I do on August 5')?.from, '2026-08-05');
  assert.equal(on('summarise 2026-08-03')?.from, '2026-08-03');
  assert.equal(on('what happened on 5 August 2025')?.from, '2025-08-05');
});

test('a bare date in the future is read as last year', () => {
  // People ask what they did, not what they will do — December is behind us.
  assert.equal(on('what did I do on the 25th of December')?.from, '2025-12-25');
});

test('an impossible date is refused rather than rolled over', () => {
  // Date() would silently turn 31 February into 3 March and answer confidently
  // about the wrong day.
  assert.equal(on('what did I do on the 31st of February'), null);
});

test('a question with no date in it gets none', () => {
  assert.equal(on('do I have any pages regarding the lease'), null);
  assert.equal(on('what did I say about the mortgage'), null);
});

/* ---------- which notes ---------- */

test('the scaffolding of a question is not searched for', () => {
  // Every one of these words appears in half the vault; left in, they drown the
  // one or two that carry the question.
  assert.deepEqual(ask.keywords('do I have any pages regarding the lease'), ['lease']);
  assert.deepEqual(ask.keywords('what did I say about the mortgage renewal'), ['mortgage', 'renewal']);
});

/* ---------- building the request ---------- */

const NOTE = (over = {}) => ({
  id: 'a',
  typeId: 'daily',
  title: 'Thursday',
  dateKey: '2026-08-06',
  text: 'Met Ana about the lease. Renewal is due in October.',
  ...over,
});

const TYPES = [
  { id: 'daily', name: 'Daily Note' },
  { id: 'task', name: 'Task' },
  { id: 'note', name: 'Note' },
  { id: 'movie', name: 'Movie' },
];

const lookupWith = (results) => {
  const calls = { onDates: 0, search: 0, words: null, typeId: undefined };
  return {
    calls,
    lookup: {
      onDates: ({ typeId }) => {
        calls.onDates++;
        calls.typeId = typeId;
        return results;
      },
      search: ({ words, typeId }) => {
        calls.search++;
        calls.words = words;
        calls.typeId = typeId;
        return calls.searchFinds ?? results;
      },
      ofType: (typeId) => {
        calls.ofType = typeId;
        return results;
      },
    },
  };
};

const build = (question, lookup, types = TYPES) => ask.askRequest({ question, today: TODAY, lookup, types });

test('a dated question reads that day, and does not also search', () => {
  const { calls, lookup } = lookupWith([NOTE()]);
  const built = build('summarise my daily note two days ago', lookup);
  assert.equal(calls.onDates, 1);
  assert.equal(calls.search, 0);
  assert.equal(built.dates.from, '2026-08-06');
  assert.ok(built.request.prompt.includes('Met Ana about the lease'));
});

test('an undated question searches instead', () => {
  const { calls, lookup } = lookupWith([NOTE()]);
  build('do I have any pages regarding the lease', lookup);
  assert.equal(calls.onDates, 0);
  assert.deepEqual(calls.words, ['lease']);
});

test('an empty day says so instead of quietly answering about another one', () => {
  // Falling back to a text search here would answer a different question than
  // the one that was asked, and look like it had worked.
  const { lookup } = lookupWith([]);
  const built = build('what did I do yesterday', lookup);
  assert.match(built.error, /is filed under yesterday/);
  assert.equal(built.request, undefined);
});

test('an empty search says so too', () => {
  const { lookup } = lookupWith([]);
  const built = build('anything about the lease', lookup);
  assert.match(built.error, /Nothing in the vault/);
});

test('a question with nothing in it is refused before any lookup', () => {
  const { calls, lookup } = lookupWith([NOTE()]);
  assert.match(build('   ', lookup).error, /Ask a question/);
  assert.equal(calls.onDates + calls.search, 0);
});

test('the notes given to the model stay inside the context window', () => {
  const many = Array.from({ length: 12 }, (_, i) => NOTE({ id: 'n' + i, text: 'x'.repeat(5000) }));
  const { lookup } = lookupWith(many);
  const built = build('what did I do yesterday', lookup);
  assert.ok(built.sources.length <= ask.MAX_SOURCES, 'sources are capped');
  // Some slack for the numbering, titles and the question itself.
  assert.ok(built.request.prompt.length < ask.CONTEXT_CHARS + 1200, `prompt was ${built.request.prompt.length}`);
});

test('one long note cannot crowd the others out', () => {
  const { lookup } = lookupWith([
    NOTE({ id: 'big', text: 'y'.repeat(9000) }),
    NOTE({ id: 'small', title: 'Short one', text: 'the lease was signed' }),
  ]);
  const built = build('what did I do yesterday', lookup);
  assert.ok(built.request.prompt.includes('the lease was signed'), 'the short note survived');
});

test('the sources come back so the answer can be checked', () => {
  const { lookup } = lookupWith([NOTE()]);
  const built = build('what did I do yesterday', lookup);
  assert.deepEqual(built.sources, [{ id: 'a', title: 'Thursday', typeId: 'daily', dateKey: '2026-08-06' }]);
  // The text itself is not echoed back to the renderer — it only went to the model.
  assert.ok(!('text' in built.sources[0]));
});

test('the model is told not to answer from anywhere but the notes', () => {
  // Without this the model fills gaps from its training, which in a notes app
  // reads as the app inventing things about your life.
  const { lookup } = lookupWith([NOTE()]);
  const { request } = build('what did I do yesterday', lookup);
  assert.match(request.instructions, /only/i);
  assert.match(request.instructions, /say so/i);
});

/* ---------- what the model is actually asked ---------- */

test('an existence question is rewritten into one worth answering', () => {
  // "Yes, there are notes about the lease" is a true answer and a useless one —
  // the list of sources already said that, better.
  assert.equal(ask.focus('Do I have any pages about the lease?'), 'What do these notes say about lease?');
  assert.equal(ask.focus('Is there anything about the dentist?'), 'What do these notes say about dentist?');
  assert.equal(ask.focus('any notes on the mortgage'), 'What do these notes say about mortgage?');
  assert.equal(ask.focus('show me my notes about Ana'), 'What do these notes say about Ana?');
});

test('a real question is left exactly as it was asked', () => {
  for (const q of ['What did I decide about the lease?', 'Who is the landlord?', 'Summarise yesterday']) {
    assert.equal(ask.focus(q), q);
  }
});

test('the rewrite reaches the model but never the user', () => {
  const { lookup } = lookupWith([NOTE()]);
  const built = build('Do I have any pages about the lease?', lookup);
  assert.match(built.request.prompt, /What do these notes say about lease\?/);
});


/* ---------- the whole vault, not just the daily notes ---------- */

test('a question that names a kind of thing is scoped to that type', () => {
  // "movies" finds nothing by text — the word appears nowhere in a list of films
  // — but it is exactly a type, which is what makes the question answerable.
  const { calls, lookup } = lookupWith([NOTE()]);
  build('what movies did I watch', lookup);
  assert.equal(calls.typeId, 'movie');
});

test('a kind and a day together narrow to both', () => {
  const { calls, lookup } = lookupWith([NOTE()]);
  const built = build('do I have any tasks today', lookup);
  assert.equal(calls.onDates, 1);
  assert.equal(calls.typeId, 'task');
  assert.equal(built.dates.from, TODAY);
  assert.equal(built.type.name, 'Task');
});

test('plurals of either spelling find their type', () => {
  assert.equal(ask.matchType('what movies did I watch', TYPES)?.id, 'movie');
  assert.equal(ask.matchType('any tasks left', TYPES)?.id, 'task');
  assert.equal(ask.matchType('my task list', TYPES)?.id, 'task');
});

test('a two-word type beats the one-word type inside it', () => {
  // "daily note" must not resolve to "Note", which would read the wrong things.
  assert.equal(ask.matchType('summarise my daily note two days ago', TYPES)?.id, 'daily');
});

test('the name of the type is not also searched for as text', () => {
  // "any tasks about the lease" means the lease, among tasks — not the word "tasks".
  const { calls, lookup } = lookupWith([NOTE()]);
  build('any tasks about the lease', lookup);
  assert.deepEqual(calls.words, ['lease']);
  assert.equal(calls.typeId, 'task');
});

test('a question naming no kind is not scoped to one', () => {
  const { calls, lookup } = lookupWith([NOTE()]);
  build('anything about the lease', lookup);
  assert.equal(calls.typeId, undefined);
});

test('what a thing is, and its properties, reach the model', () => {
  // Most tasks have no body at all — the title, type and due date are the whole
  // answer to "do I have any tasks today".
  const { lookup } = lookupWith([
    { id: 't', typeId: 'task', typeName: 'Task', title: 'Call the dentist', dateKey: null, detail: 'due: 2026-08-08 · status: To do', text: '' },
  ]);
  const built = build('do I have any tasks today', lookup);
  assert.match(built.request.prompt, /Call the dentist \(Task\)/);
  assert.match(built.request.prompt, /status: To do/);
});

test('an empty day says which kind it looked for', () => {
  const { lookup } = lookupWith([]);
  assert.match(build('do I have any tasks today', lookup).error, /kind “task”.*today/i);
});

test('a kind whose words match nothing still answers with that kind', () => {
  // "What movies did I watch" leaves "watch" as the subject, and no film has
  // that word anywhere in it — but the question was plainly about movies.
  const { calls, lookup } = lookupWith([NOTE()]);
  calls.searchFinds = [];
  const built = build('what movies did I watch', lookup);
  assert.equal(calls.ofType, 'movie');
  assert.ok(built.sources.length > 0);
});

test('but an empty day is still an empty day', () => {
  // Falling back to every task ever would answer a different question, and look
  // like it had worked.
  const { calls, lookup } = lookupWith([]);
  const built = build('do I have any tasks tomorrow', lookup);
  assert.equal(calls.ofType, undefined);
  assert.match(built.error, /is filed under tomorrow/);
});

test('date words are spent once the date is read, not asked about as well', () => {
  // Left in, "do I have any tasks today" reaches the model as "what do these
  // notes say about today" — and the answer is that they do not mention it.
  const { lookup } = lookupWith([NOTE()]);
  const built = build('do I have any tasks today', lookup);
  assert.doesNotMatch(built.request.prompt, /say about today/);
  assert.match(built.request.prompt, /Name each one/);
});

test('a real subject survives alongside the date', () => {
  const { lookup } = lookupWith([NOTE()]);
  const built = build('any tasks about the lease today', lookup);
  assert.match(built.request.prompt, /say about lease\?/);
});

test('an undated question still searches for its subject', () => {
  const { calls, lookup } = lookupWith([NOTE()]);
  build('any tasks about the lease', lookup);
  assert.deepEqual(calls.words, ['lease']);
  assert.equal(calls.typeId, 'task');
});

test('a question naming only a kind and a day asks for them by name', () => {
  // "What do these notes say about tasks?" comes back "two tasks are due today",
  // which is true and leaves out the only part worth having.
  assert.match(ask.focus('Do I have any tasks today?', { type: TYPES[1], subject: [] }), /Name each one/);
});

test('date words are not left in the topic either', () => {
  const asked = ask.focus('anything about the lease today', { subject: ['lease'], dated: true });
  assert.equal(asked, 'What do these notes say about lease?');
});

test('an undated question keeps words that only look temporal', () => {
  // "May" is a month and a name; with no date read, it is still a subject.
  const { calls, lookup } = lookupWith([NOTE()]);
  build('anything about May', lookup);
  assert.deepEqual(calls.words, ['may']);
});
