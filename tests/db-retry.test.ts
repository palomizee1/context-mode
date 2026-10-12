import { describe, expect, test } from "vitest";
import { isSQLiteCorruptionError, withRetry } from "../src/db-base.js";

// Ported from upstream PR #1030.
describe("withRetry", () => {
  const failing = (messages: string[]) => {
    let calls = 0;
    return {
      fn: () => {
        const msg = messages[calls++];
        if (msg) throw new Error(msg);
        return "ok";
      },
      calls: () => calls,
    };
  };

  test("retries a transient SQLITE_IOERR and succeeds", () => {
    const op = failing(["SQLITE_IOERR: disk I/O error"]);
    expect(withRetry(op.fn, [0, 0, 0])).toBe("ok");
    expect(op.calls()).toBe(2);
  });

  test("still retries SQLITE_BUSY", () => {
    const op = failing(["SQLITE_BUSY: database is locked", "database is locked"]);
    expect(withRetry(op.fn, [0, 0, 0])).toBe("ok");
    expect(op.calls()).toBe(3);
  });

  test("names IOERR when retries are exhausted", () => {
    const op = failing(Array(4).fill("disk I/O error"));
    expect(() => withRetry(op.fn, [0, 0, 0])).toThrow(/^SQLITE_IOERR: disk I\/O error after 3 retries/);
  });

  test("does not retry unrelated errors", () => {
    const op = failing(["no such table: x"]);
    expect(() => withRetry(op.fn, [0, 0, 0])).toThrow("no such table: x");
    expect(op.calls()).toBe(1);
  });

  test("IOERR is not classified as corruption", () => {
    expect(isSQLiteCorruptionError("SQLITE_IOERR: disk I/O error")).toBe(false);
  });
});
