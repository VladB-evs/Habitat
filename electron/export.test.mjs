// Export is the one path where a bug loses data silently — a note that comes out
// wrong is only noticed once the original is gone. These cover the Markdown
// conversion, the round trip back through the importer, and the promise that no
// token ever reaches an export file. Run with `npm test`.

import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { docToMd, writeMarkdown, safeFile } = require('./export.js');
const { mdToDoc } = require('./markdown.js');
const dbmod = require('./db.js');

const api = dbmod.api;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-export-'));
const file = path.join(tmp, 'test.db');

const p = (...content) => ({ type: 'paragraph', content });
const t = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((m) => ({ type: m })) } : {}) });
const doc = (...content) => ({ type: 'doc', content });

before(() => {
  dbmod.initDb(file);
  dbmod.seedFlavor('work');
});

after(() => {
  dbmod.closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('marks nest innermost-first', () => {
  assert.equal(docToMd(doc(p(t('plain')))), 'plain');
  assert.equal(docToMd(doc(p(t('x', 'bold')))), '**x**');
  assert.equal(docToMd(doc(p(t('x', 'bold', 'italic')))), '***x***');
  assert.equal(docToMd(doc(p(t('x', 'code')))), '`x`');
  assert.equal(docToMd(doc(p(t('x', 'strike')))), '~~x~~');
  // Colour has no Markdown; the text must still survive.
  assert.equal(docToMd(doc(p(t('x', 'textStyle')))), 'x');
});

test('a block loses its trailing space but keeps a hard break', () => {
  assert.equal(docToMd(doc(p(t('trailing ')))), 'trailing');
  assert.equal(docToMd(doc(p(t('one'), { type: 'hardBreak' }, t('two')))), 'one  \ntwo');
});

test('block structures', () => {
  assert.equal(docToMd(doc({ type: 'heading', attrs: { level: 2 }, content: [t('Title')] })), '## Title');
  assert.equal(
    docToMd(doc({ type: 'codeBlock', attrs: { language: 'js' }, content: [t('a\nb')] })),
    '```js\na\nb\n```'
  );
  assert.equal(docToMd(doc({ type: 'horizontalRule' })), '---');
  assert.equal(docToMd(doc({ type: 'blockquote', content: [p(t('quoted'))] })), '> quoted');
});

test('lists, including checkboxes and numbering', () => {
  const bullets = { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('one'))] }, { type: 'listItem', content: [p(t('two'))] }] };
  assert.equal(docToMd(doc(bullets)), '- one\n- two');

  const ordered = { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('a'))] }, { type: 'listItem', content: [p(t('b'))] }] };
  assert.equal(docToMd(doc(ordered)), '1. a\n2. b');

  const tasks = {
    type: 'taskList',
    content: [
      { type: 'taskItem', attrs: { checked: true }, content: [p(t('done'))] },
      { type: 'taskItem', attrs: { checked: false }, content: [p(t('todo'))] },
    ],
  };
  assert.equal(docToMd(doc(tasks)), '- [x] done\n- [ ] todo');
});

test('mentions and tags come out as the importer reads them', () => {
  const d = doc(p(t('see '), { type: 'mention', attrs: { id: 'x1', label: 'My Note' } }, t(' and '), { type: 'tagMention', attrs: { id: 't1', label: 'idea' } }));
  assert.equal(docToMd(d), 'see [[My Note]] and #idea');
});

test('a doc survives the round trip out to Markdown and back', () => {
  const original = doc(
    { type: 'heading', attrs: { level: 1 }, content: [t('Notes')] },
    p(t('Some '), t('bold', 'bold'), t(' text.')),
    { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('first'))] }, { type: 'listItem', content: [p(t('second'))] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('shipped'))] }] },
    { type: 'codeBlock', attrs: { language: '' }, content: [t('code()')] }
  );

  const back = mdToDoc(docToMd(original));
  const kinds = back.content.map((n) => n.type);
  assert.deepEqual(kinds, ['heading', 'paragraph', 'bulletList', 'taskList', 'codeBlock']);
  assert.equal(back.content[0].content[0].text, 'Notes');
  assert.equal(back.content[2].content.length, 2);
  assert.equal(back.content[3].content[0].attrs.checked, true);
  assert.equal(back.content[4].content[0].text, 'code()');
});

test('tables become pipe tables, and a pipe in a cell is escaped', () => {
  const cell = (text) => ({ type: 'tableCell', content: [p(t(text))] });
  const table = {
    type: 'table',
    content: [
      { type: 'tableRow', content: [cell('a'), cell('b')] },
      { type: 'tableRow', content: [cell('c|d'), cell('e')] },
    ],
  };
  assert.equal(docToMd(doc(table)), '| a | b |\n| --- | --- |\n| c\\|d | e |');
});

test('filenames stay readable but never break the filesystem', () => {
  assert.equal(safeFile('Trip: Lisbon/Porto'), 'Trip- Lisbon-Porto');
  assert.equal(safeFile('   '), 'Untitled');
  assert.equal(safeFile('..'), 'Untitled');
  assert.equal(safeFile('x'.repeat(300)).length, 120);
});

test('export:data carries the vault but never a token', () => {
  api['api:config'](); // mints and stores the HTTP token
  api['telegram:save']({ token: '123456:SECRET-TOKEN' });

  const data = api['export:data']();
  assert.ok(data.types.length > 0);
  const keys = data.settings.map((s) => s.key);
  assert.ok(!keys.includes('httpApi'), 'API token must not be exported');
  assert.ok(!keys.includes('telegram'), 'Telegram token must not be exported');
  assert.ok(!JSON.stringify(data).includes('SECRET-TOKEN'));
});

test('writeMarkdown lays out a folder per type, with front matter', () => {
  const note = api['objects:create']({
    typeId: 'note',
    title: 'Hello there',
    content: doc(p(t('body text'))),
  });
  api['objects:update']({ id: note.id, patch: { props: {} } });

  const root = path.join(tmp, 'out');
  fs.mkdirSync(root, { recursive: true });
  const res = writeMarkdown(root, api['export:data'](), null);

  assert.ok(res.written > 0);
  const noteFile = path.join(root, 'Note', 'Hello there.md');
  assert.ok(fs.existsSync(noteFile), 'note should land in a folder named after its type');

  const text = fs.readFileSync(noteFile, 'utf8');
  assert.match(text, /^---\n/);
  assert.match(text, /title: Hello there/);
  assert.match(text, /type: Note/);
  assert.match(text, /body text/);
});

test('two objects with the same title get separate files', () => {
  api['objects:create']({ typeId: 'note', title: 'Same Name' });
  api['objects:create']({ typeId: 'note', title: 'Same Name' });

  const root = path.join(tmp, 'dupes');
  fs.mkdirSync(root, { recursive: true });
  writeMarkdown(root, api['export:data'](), null);

  assert.ok(fs.existsSync(path.join(root, 'Note', 'Same Name.md')));
  assert.ok(fs.existsSync(path.join(root, 'Note', 'Same Name 2.md')), 'a collision must not overwrite');
});
