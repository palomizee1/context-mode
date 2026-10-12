import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  cleanupStaleContentFiles,
  closeProjectStore,
  getStore,
  getStorePath,
} from "../src/project-context.js";
import { REGISTERED_CTX_TOOLS, withProjectDirOverride } from "../src/server.js";

const ENV_KEYS = ["CONTEXT_MODE_INDEX", "CONTEXT_MODE_DIR", "CONTEXT_MODE_TTL_HOURS"] as const;

describe("index retention", () => {
  let saved: Record<string, string | undefined>;
  let stateDir: string;
  let project: string;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    stateDir = mkdtempSync(join(tmpdir(), "context-mode-state-"));
    project = mkdtempSync(join(tmpdir(), "context-mode-retention-"));
    process.env.CONTEXT_MODE_DIR = stateDir;
  });

  afterEach(() => {
    closeProjectStore(project);
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });

  test("ephemeral (default) indexes in memory and writes no DB file", async () => {
    const index = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_index")!;
    const search = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_search")!;
    await withProjectDirOverride(project, () => index.handler({ content: "ephemeral marmalade", source: "eph" }));
    const result = await withProjectDirOverride(project, () => search.handler({ queries: ["marmalade"] })) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0]?.text).toContain("marmalade");
    const contentDir = join(stateDir, "content");
    const dbFiles = existsSync(contentDir) ? readdirSync(contentDir).filter((n) => n.includes(".db")) : [];
    expect(dbFiles).toEqual([]);
  });

  test("ephemeral purge drops the in-memory index", async () => {
    const purge = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_purge")!;
    getStore(project).indexPlainText("purge me please", "p");
    expect(getStore(project).isEmpty()).toBe(false);
    const result = await withProjectDirOverride(project, () => purge.handler({ confirm: true })) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0]?.text).toContain("in-memory");
    expect(getStore(project).isEmpty()).toBe(true);
  });

  test("persist mode drops sources older than the TTL on reopen", async () => {
    process.env.CONTEXT_MODE_INDEX = "persist";
    getStore(project).indexPlainText("persisted pomegranate", "old");
    closeProjectStore(project);
    expect(existsSync(getStorePath(project))).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 2_100));
    process.env.CONTEXT_MODE_TTL_HOURS = "0.0001";
    expect(getStore(project).search("pomegranate")).toEqual([]);
  });

  test("persist mode keeps sources within the TTL", () => {
    process.env.CONTEXT_MODE_INDEX = "persist";
    getStore(project).indexPlainText("fresh kumquat", "new");
    closeProjectStore(project);
    expect(getStore(project).search("kumquat").length).toBeGreaterThan(0);
  });

  test("cleanupStaleContentFiles removes stale DBs and quarantine copies only", () => {
    const dir = join(stateDir, "content");
    getStore(project); // ephemeral: does not create the dir
    process.env.CONTEXT_MODE_INDEX = "persist";
    const contentDir = getStorePath(project).replace(/[^/\\]+$/, "");
    expect(contentDir.startsWith(dir)).toBe(true);

    const old = join(dir, "x.db");
    const quarantine = join(dir, "y.db.corrupt-1");
    const fresh = join(dir, "z.db");
    const unrelated = join(dir, "notes.txt");
    for (const p of [old, quarantine, fresh, unrelated]) writeFileSync(p, "x");
    const twoDaysAgo = new Date(Date.now() - 48 * 3_600_000);
    utimesSync(old, twoDaysAgo, twoDaysAgo);
    utimesSync(unrelated, twoDaysAgo, twoDaysAgo);

    expect(cleanupStaleContentFiles(24)).toBe(2);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(quarantine)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
  });
});
