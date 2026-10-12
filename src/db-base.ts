import { DatabaseSync, type StatementSync } from "node:sqlite";
import { existsSync, renameSync, unlinkSync } from "node:fs";

export interface PreparedStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }; // numbers: readBigInts is off
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
}

/** The slice of the better-sqlite3 API the store uses, backed by the built-in node:sqlite. */
export interface SqliteDatabase {
  pragma(source: string): void;
  exec(sql: string): void;
  prepare(sql: string): PreparedStatement;
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  close(): void;
}

class NodeSqliteDatabase implements SqliteDatabase {
  readonly #raw: DatabaseSync;
  #depth = 0;

  constructor(raw: DatabaseSync) {
    this.#raw = raw;
  }

  pragma(source: string): void {
    this.#raw.prepare(`PRAGMA ${source}`).all();
  }

  exec(sql: string): void {
    this.#raw.exec(sql);
  }

  prepare(sql: string): PreparedStatement {
    return this.#raw.prepare(sql) as StatementSync as unknown as PreparedStatement;
  }

  // Like better-sqlite3: BEGIN/COMMIT at the top level, SAVEPOINTs when nested.
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      const savepoint = this.#depth > 0 ? `ctx_sp_${this.#depth}` : null;
      this.#raw.exec(savepoint ? `SAVEPOINT ${savepoint}` : "BEGIN");
      this.#depth++;
      try {
        const result = fn(...args);
        this.#depth--;
        this.#raw.exec(savepoint ? `RELEASE ${savepoint}` : "COMMIT");
        return result;
      } catch (err) {
        this.#depth--;
        try {
          this.#raw.exec(savepoint ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK");
        } catch { /* the failure may already have ended the transaction */ }
        throw err;
      }
    };
  }

  close(): void {
    this.#raw.close();
  }
}

/** Open a database with the built-in node:sqlite (no native addon). */
export function openDatabase(path: string, opts: { timeout?: number } = {}): SqliteDatabase {
  const db = new NodeSqliteDatabase(new DatabaseSync(path));
  if (opts.timeout) db.pragma(`busy_timeout = ${Math.floor(opts.timeout)}`);
  return db;
}

export function applyWALPragmas(db: SqliteDatabase): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("secure_delete = ON");
  // mmap is opt-in (CONTEXT_MODE_MMAP_SIZE=<bytes>): several server processes can
  // share a persist-mode DB, and a fault on a mapping a sibling truncated or
  // replaced is an uncatchable signal rather than an error (upstream #1056).
  const mmapSize = Number(process.env.CONTEXT_MODE_MMAP_SIZE ?? "0");
  if (Number.isFinite(mmapSize) && mmapSize > 0) {
    try { db.pragma(`mmap_size = ${Math.floor(mmapSize)}`); } catch {}
  }
}

export function cleanOrphanedWALFiles(dbPath: string): void {
  if (dbPath === ":memory:" || existsSync(dbPath)) return;
  for (const suffix of ["-wal", "-shm"]) {
    try { unlinkSync(dbPath + suffix); } catch {}
  }
}

export function quarantineDBFiles(dbPath: string): string {
  const quarantineBase = `${dbPath}.corrupt-${Date.now()}`;
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = dbPath + suffix;
    if (existsSync(source)) renameSync(source, quarantineBase + suffix);
  }
  return quarantineBase;
}

export function deleteDBFiles(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(dbPath + suffix); } catch {}
  }
}

// No TRUNCATE checkpoint on close: it mutated a WAL that sibling processes were
// still using (upstream #1056). SQLite checkpoints and removes the WAL when the
// last connection closes, and the PASSIVE timer below bounds it meanwhile.
export function closeDB(db: SqliteDatabase): void {
  try { db.close(); } catch {}
}

/**
 * Periodic PASSIVE WAL checkpoint (upstream #988) so a persist-mode WAL stays
 * bounded even if the server is killed before the last connection closes.
 * PASSIVE never blocks. Returns a stop function; a non-positive interval is a no-op.
 */
export function startWalCheckpointTimer(db: SqliteDatabase, intervalMs: number): () => void {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => {};
  const timer = setInterval(() => {
    try { db.pragma("wal_checkpoint(PASSIVE)"); } catch { /* busy or closing: next tick */ }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

// Transient SQLite failures worth retrying. SQLITE_IOERR is usually a momentary
// filesystem stall (on macOS: Spotlight/iCloud touching the file, WAL hiccups).
// It must NOT be treated as corruption: that path renames the DB away.
const TRANSIENT_ERROR_PATTERNS = ["SQLITE_BUSY", "database is locked", "SQLITE_IOERR", "disk I/O error"];

export function withRetry<T>(fn: () => T, delays: number[] = [100, 500, 2000]): T {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return fn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!TRANSIENT_ERROR_PATTERNS.some((p) => msg.includes(p))) throw err;
      lastError = err instanceof Error ? err : new Error(msg);
      if (attempt < delays.length) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[attempt]);
      }
    }
  }
  // Name the class we actually exhausted on, so the caller chases the right cause.
  const failure = lastError?.message ?? "";
  const cause = failure.includes("SQLITE_IOERR") || failure.includes("disk I/O error")
    ? "SQLITE_IOERR: disk I/O error"
    : "SQLITE_BUSY: database is locked";
  throw new Error(`${cause} after ${delays.length} retries. Original error: ${lastError?.message}`);
}

export function isSQLiteCorruptionError(msg: string): boolean {
  return msg.includes("SQLITE_CORRUPT") ||
    msg.includes("SQLITE_NOTADB") ||
    msg.includes("database disk image is malformed") ||
    msg.includes("file is not a database");
}
