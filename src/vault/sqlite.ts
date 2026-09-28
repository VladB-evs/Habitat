import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

let sqlite3: any = null;
let sahPoolUtil: any = null;
let initPromise: Promise<any> | null = null;

export async function initSqlite() {
  if (sqlite3) return sqlite3;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const mod = await (sqlite3InitModule as any)({
          print: console.log,
          printErr: console.error,
        });

        // Try to install OPFS SAH Pool VFS if in a worker context supporting it
        if (typeof (mod as any).installOpfsSAHPoolVfs === 'function') {
          try {
            sahPoolUtil = await (mod as any).installOpfsSAHPoolVfs();
            console.log('[sqlite] OPFS SAHPool VFS installed successfully');
          } catch (sahErr) {
            console.warn('[sqlite] OPFS SAHPool not available, will use standard DB/memory:', sahErr);
          }
        }
        sqlite3 = mod;
        return sqlite3;
      } catch (err) {
        console.error('[sqlite] Failed to initialize sqlite-wasm:', err);
        throw err;
      }
    })();
  }
  return initPromise;
}

export class StatementShim {
  private _db: any;
  private _stmt: any;

  constructor(db: any, stmt: any) {
    this._db = db;
    this._stmt = stmt;
  }

  private _bind(args: any[]) {
    this._stmt.reset(true);
    if (!args || args.length === 0) return;
    const normalize = (v: any) => (v === undefined ? null : v);
    const flat = (args.length === 1 && Array.isArray(args[0]))
      ? args[0].map(normalize)
      : (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !(args[0] instanceof Uint8Array))
        ? args[0]
        : args.map(normalize);
    this._stmt.bind(flat);
  }

  run(...args: any[]) {
    this._bind(args);
    this._stmt.step();
    const changes = this._db.changes();
    this._stmt.reset(true);
    return { changes, lastInsertRowid: 0 };
  }

  get(...args: any[]) {
    this._bind(args);
    let row: any = undefined;
    if (this._stmt.step()) {
      row = this._stmt.get({});
    }
    this._stmt.reset(true);
    return row;
  }

  all(...args: any[]) {
    this._bind(args);
    const rows: any[] = [];
    while (this._stmt.step()) {
      rows.push(this._stmt.get({}));
    }
    this._stmt.reset(true);
    return rows;
  }

  finalize() {
    this._stmt.finalize();
  }
}

export class DatabaseSync {
  private _raw: any;
  private _stmtCache: Map<string, StatementShim>;

  constructor(file: string) {
    if (!sqlite3) {
      throw new Error('SQLite WASM not initialized yet. Ensure await initSqlite() ran before creating DatabaseSync.');
    }
    this._stmtCache = new Map();

    const normalizedName = file.startsWith('/') ? file : '/' + file;
    // 1. Try OpfsSAHPoolDb if available and not explicitly :memory:
    const OpfsPoolDb = sahPoolUtil?.OpfsSAHPoolDb || sqlite3.oo1?.OpfsSAHPoolDb;
    if (file !== ':memory:' && OpfsPoolDb) {
      try {
        this._raw = new OpfsPoolDb(normalizedName);
        console.log('[sqlite] Opened OpfsSAHPoolDb:', normalizedName);
      } catch (err) {
        console.warn('[sqlite] OpfsSAHPoolDb open failed, falling back to standard oo1.DB:', err);
      }
    }

    // 2. If not opened, try OpfsDb if available
    if (!this._raw && file !== ':memory:' && sqlite3.oo1?.OpfsDb) {
      try {
        this._raw = new sqlite3.oo1.OpfsDb(normalizedName);
        console.log('[sqlite] Opened OpfsDb:', normalizedName);
      } catch (err) {
        console.warn('[sqlite] OpfsDb open failed, falling back to in-memory oo1.DB:', err);
      }
    }

    // 3. Fallback to standard oo1.DB
    if (!this._raw) {
      this._raw = new sqlite3.oo1.DB(file);
      console.log('[sqlite] Opened oo1.DB:', file);
    }
  }

  exec(sql: string) {
    return this._raw.exec(sql);
  }

  prepare(sql: string) {
    let stmt = this._stmtCache.get(sql);
    if (!stmt) {
      const rawStmt = this._raw.prepare(sql);
      stmt = new StatementShim(this._raw, rawStmt);
      this._stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  close() {
    for (const stmt of this._stmtCache.values()) {
      try {
        stmt.finalize();
      } catch {}
    }
    this._stmtCache.clear();
    try {
      this._raw.close();
    } catch {}
  }
}

export default {
  DatabaseSync,
  initSqlite,
};
