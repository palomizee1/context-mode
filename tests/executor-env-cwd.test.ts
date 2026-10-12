import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PolyglotExecutor } from "../src/executor.js";

// Ported from upstream PR #1286.
describe("executor with a project directory that no longer exists", () => {
  const removed = mkdtempSync(join(tmpdir(), "ctx-gone-"));
  rmSync(removed, { recursive: true, force: true });

  test("still runs code, in a temporary directory, and says why", async () => {
    const executor = new PolyglotExecutor({ projectRoot: () => removed });
    try {
      const result = await executor.execute({ language: "javascript", code: "console.log(process.cwd())", timeout: 20_000 });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toMatch(/ENOENT/);
      expect(result.stderr).toContain(`project directory ${removed} no longer exists`);
      const ranIn = result.stdout.trim();
      expect(ranIn).not.toBe(removed);
      expect(ranIn).toContain(".ctx-mode-");
    } finally {
      executor.cleanupProcesses();
    }
  });

  test("a missing explicit cwd override is reported the same way", async () => {
    const executor = new PolyglotExecutor({ projectRoot: () => process.cwd() });
    try {
      const result = await executor.execute({ language: "shell", code: "pwd", timeout: 20_000, cwd: removed });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain(`project directory ${removed} no longer exists`);
    } finally {
      executor.cleanupProcesses();
    }
  });

  test("an existing project directory is used unchanged, with no note", async () => {
    const here = mkdtempSync(join(tmpdir(), "ctx-here-"));
    const executor = new PolyglotExecutor({ projectRoot: () => here });
    try {
      const result = await executor.execute({ language: "shell", code: "pwd", timeout: 20_000 });
      expect(realpathSync(result.stdout.trim())).toBe(realpathSync(here));
      expect(result.stderr).not.toContain("no longer exists");
    } finally {
      executor.cleanupProcesses();
      rmSync(here, { recursive: true, force: true });
    }
  });
});

describe("sandboxed output stays plain when the parent forces colour", () => {
  const saved = { FORCE_COLOR: process.env.FORCE_COLOR, CLICOLOR_FORCE: process.env.CLICOLOR_FORCE };
  beforeAll(() => {
    process.env.FORCE_COLOR = "3";
    process.env.CLICOLOR_FORCE = "1";
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("javascript console.log of a number has no escape codes", async () => {
    const executor = new PolyglotExecutor({ projectRoot: () => process.cwd() });
    try {
      const r = await executor.execute({ language: "javascript", code: 'console.log("even sum:", 2550)', timeout: 20_000 });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe("even sum: 2550\n");
    } finally {
      executor.cleanupProcesses();
    }
  });

  test("the child sees no colour-forcing variables", async () => {
    const executor = new PolyglotExecutor({ projectRoot: () => process.cwd() });
    try {
      const r = await executor.execute({
        language: "shell",
        code: 'echo "[${FORCE_COLOR-unset}] [${CLICOLOR_FORCE-unset}] [$NO_COLOR]"',
        timeout: 20_000,
      });
      expect(r.stdout.trim()).toBe("[unset] [unset] [1]");
    } finally {
      executor.cleanupProcesses();
    }
  });
});
