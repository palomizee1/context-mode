import { afterEach, describe, expect, test } from "vitest";
import { PolyglotExecutor } from "../src/executor.js";

// Ported from upstream PR #968 (issue #936).
describe("CONTEXT_MODE_DEFAULT_TIMEOUT_MS", () => {
  afterEach(() => { delete process.env.CONTEXT_MODE_DEFAULT_TIMEOUT_MS; });

  const run = async (timeout?: number) => {
    const executor = new PolyglotExecutor({ projectRoot: () => process.cwd() });
    try {
      return await executor.execute({ language: "javascript", code: "setTimeout(() => console.log('done'), 1500)", timeout });
    } finally {
      executor.cleanupProcesses();
    }
  };

  test("unset: no timeout is applied", async () => {
    const result = await run();
    expect(result.timedOut).toBe(false);
    expect(result.stdout.trim()).toBe("done");
  });

  test("set: bounds calls that pass no timeout", async () => {
    process.env.CONTEXT_MODE_DEFAULT_TIMEOUT_MS = "300";
    const result = await run();
    expect(result.timedOut).toBe(true);
    expect(result.timeoutMs).toBe(300);
  });

  test("an explicit timeout still wins", async () => {
    process.env.CONTEXT_MODE_DEFAULT_TIMEOUT_MS = "300";
    const result = await run(10_000);
    expect(result.timedOut).toBe(false);
  });
});
