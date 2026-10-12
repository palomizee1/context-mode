import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db-base.js";

describe("node:sqlite adapter", () => {
  const fresh = () => {
    const db = openDatabase(":memory:");
    db.exec("CREATE TABLE t (v TEXT)");
    return db;
  };
  const count = (db: ReturnType<typeof openDatabase>) =>
    (db.prepare("SELECT count(*) AS n FROM t").get() as { n: number }).n;

  test("transaction commits and passes arguments and results through", () => {
    const db = fresh();
    const insert = db.transaction((a: string, b: string) => {
      db.prepare("INSERT INTO t VALUES (?)").run(a);
      return db.prepare("INSERT INTO t VALUES (?)").run(b).changes;
    });
    expect(insert("x", "y")).toBe(1);
    expect(count(db)).toBe(2);
    db.close();
  });

  test("transaction rolls back on throw", () => {
    const db = fresh();
    expect(() => db.transaction(() => {
      db.prepare("INSERT INTO t VALUES ('x')").run();
      throw new Error("boom");
    })()).toThrow("boom");
    expect(count(db)).toBe(0);
    db.close();
  });

  test("nested transaction rolls back only the inner savepoint", () => {
    const db = fresh();
    db.transaction(() => {
      db.prepare("INSERT INTO t VALUES ('outer')").run();
      try {
        db.transaction(() => {
          db.prepare("INSERT INTO t VALUES ('inner')").run();
          throw new Error("inner");
        })();
      } catch { /* expected */ }
    })();
    expect(db.prepare("SELECT v FROM t").all()).toEqual([{ v: "outer" }]);
    db.close();
  });

  test("run reports numeric changes and lastInsertRowid", () => {
    const db = fresh();
    const info = db.prepare("INSERT INTO t VALUES ('x')").run();
    expect(info.changes).toBe(1);
    expect(Number(info.lastInsertRowid)).toBe(1);
    db.close();
  });

  test("FTS5 with porter and trigram tokenizers is available", () => {
    const db = openDatabase(":memory:");
    db.exec("CREATE VIRTUAL TABLE a USING fts5(x, tokenize='porter unicode61')");
    db.exec("CREATE VIRTUAL TABLE b USING fts5(x, tokenize='trigram')");
    db.close();
  });
});
