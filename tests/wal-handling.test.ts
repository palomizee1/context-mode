import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { applyWALPragmas, openDatabase, startWalCheckpointTimer } from "../src/db-base.js";

// Ported from upstream PRs #1056 and #988.
describe("WAL handling", () => {
  const dirs: string[] = [];
  afterEach(() => {
    delete process.env.CONTEXT_MODE_MMAP_SIZE;
    vi.useRealTimers();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const fileDb = () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-wal-"));
    dirs.push(dir);
    return openDatabase(join(dir, "t.db"));
  };
  const mmap = (db: ReturnType<typeof openDatabase>) =>
    (db.prepare("PRAGMA mmap_size").get() as { mmap_size: number }).mmap_size;

  test("mmap is off by default", () => {
    const db = fileDb();
    applyWALPragmas(db);
    expect(mmap(db)).toBe(0);
    db.close();
  });

  test("CONTEXT_MODE_MMAP_SIZE opts in", () => {
    process.env.CONTEXT_MODE_MMAP_SIZE = "1048576";
    const db = fileDb();
    applyWALPragmas(db);
    expect(mmap(db)).toBe(1048576);
    db.close();
  });

  test("checkpoint timer issues PASSIVE checkpoints and stops", () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const db = { pragma: (s: string) => { calls.push(s); } } as unknown as ReturnType<typeof openDatabase>;
    const stop = startWalCheckpointTimer(db, 1000);
    vi.advanceTimersByTime(2500);
    expect(calls).toEqual(["wal_checkpoint(PASSIVE)", "wal_checkpoint(PASSIVE)"]);
    stop();
    vi.advanceTimersByTime(5000);
    expect(calls).toHaveLength(2);
  });

  test("a non-positive interval disables the timer", () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const db = { pragma: (s: string) => { calls.push(s); } } as unknown as ReturnType<typeof openDatabase>;
    startWalCheckpointTimer(db, 0)();
    vi.advanceTimersByTime(10_000);
    expect(calls).toEqual([]);
  });
});
