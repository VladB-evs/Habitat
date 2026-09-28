import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'module';
import { DatabaseSync, initSqlite } from '../src/vault/sqlite.ts';

test('sqlite-wasm DatabaseSync shim', async (t) => {
  await initSqlite();

  await t.test('exec, prepare, run, get, and all statements', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT, count INTEGER);
    `);

    const insert = db.prepare('INSERT INTO items (id, title, count) VALUES (?, ?, ?)');
    const r1 = insert.run('i1', 'First', 10);
    assert.equal(r1.changes, 1);

    insert.run(['i2', 'Second', 20]);
    insert.run('i3', 'Third', 30);

    const getStmt = db.prepare('SELECT * FROM items WHERE id = ?');
    assert.deepEqual(getStmt.get('i1'), { id: 'i1', title: 'First', count: 10 });
    assert.deepEqual(getStmt.get('i2'), { id: 'i2', title: 'Second', count: 20 });
    assert.equal(getStmt.get('nonexistent'), undefined);

    const allStmt = db.prepare('SELECT * FROM items WHERE count >= ? ORDER BY count ASC');
    const rows = allStmt.all(15);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, 'i2');
    assert.equal(rows[1].id, 'i3');

    db.close();
  });

  await t.test('runs Habitat db.js schema, objects and sync over sqlite-wasm', async () => {
    // Monkey-patch require('node:sqlite') for this test subcontext
    const origRequire = Module.prototype.require;
    Module.prototype.require = function(modPath) {
      if (modPath === 'node:sqlite' || modPath === 'sqlite') {
        return { DatabaseSync };
      }
      return origRequire.apply(this, arguments);
    };

    try {
      const dbModule = (await import('../electron/db.js')).default || (await import('../electron/db.js'));
      const { openVault, api, closeDb } = dbModule;

      openVault(':memory:');

      const types = api['types:list']();
      assert.ok(types.length > 0, 'default types should be seeded');

      const task = api['objects:create']({
        typeId: 'task',
        title: 'Standalone Mobile Test Task',
        props: { due: '2026-09-27' },
      });
      assert.ok(task.id, 'task object should be created');

      const fetched = api['objects:get'](task.id);
      assert.equal(fetched.title, 'Standalone Mobile Test Task');

      const snapshot = api['sync:snapshot']();
      assert.ok(snapshot.tables.objects.length >= 1, 'snapshot contains created object');

      const pull = api['sync:pull']({ cursor: 0, limit: 100 });
      assert.ok(pull.rows.length >= 1, 'pull contains change feed rows');

      closeDb();
    } finally {
      Module.prototype.require = origRequire;
    }
  });
});
