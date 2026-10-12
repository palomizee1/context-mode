import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildFetchCode } from "../src/fetch.js";

// Ported from upstream PR #1172.
describe("fetch subprocess errors", () => {
  test("a failed fetch reports its cause without a Node crash stack", () => {
    const stub = `globalThis.fetch = async () => { throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 203.0.113.1:443") }); };\n`;
    const code = stub + buildFetchCode("https://example.invalid/", join(tmpdir(), "ctx-fetch-refused-test.dat"));
    const result = spawnSync(process.execPath, ["--input-type=commonjs", "-"], { input: code, encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).not.toMatch(/node:internal|\n\s+at\s|Node\.js v/);
  });
});
