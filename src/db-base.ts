import Database from "better-sqlite3";
import type { Database as DatabaseInstance } from "better-sqlite3";
import { existsSync, renameSync, unlinkSync } from "node:fs";

export interface PreparedStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
}

export function loadDatabase(): typeof Database {
  return Database;
}

export function applyWALPragmas(db: DatabaseInstance): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("secure_delete = ON");
  try { db.pragma("mmap_size = 268435456"); } catch {}
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

export function closeDB(db: DatabaseInstance): void {
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
  try { db.close(); } catch {}
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
