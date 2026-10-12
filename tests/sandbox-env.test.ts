import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { PolyglotExecutor } from "../src/executor.js";

const SET = ["FOO_TOKEN", "AWS_SECRET_ACCESS_KEY", "DB_PASSWORD", "MY_PLAIN_SETTING", "CONTEXT_MODE_ENV_PASSTHROUGH"] as const;

async function sandboxEnvKeys(): Promise<string[]> {
  const executor = new PolyglotExecutor({ projectRoot: () => process.cwd() });
  try {
    const result = await executor.execute({
      language: "javascript",
      code: "console.log(JSON.stringify(Object.keys(process.env)))",
      timeout: 5000,
    });
    expect(result.exitCode).toBe(0);
    return JSON.parse(result.stdout.trim()) as string[];
  } finally {
    executor.cleanupProcesses();
  }
}

describe("sandbox environment", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(SET.map((k) => [k, process.env[k]]));
    process.env.FOO_TOKEN = "x";
    process.env.AWS_SECRET_ACCESS_KEY = "x";
    process.env.DB_PASSWORD = "x";
    process.env.MY_PLAIN_SETTING = "x";
    delete process.env.CONTEXT_MODE_ENV_PASSTHROUGH;
  });

  afterEach(() => {
    for (const k of SET) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("strips secret-named variables but keeps the rest", async () => {
    const keys = await sandboxEnvKeys();
    expect(keys).toContain("PATH");
    expect(keys).toContain("MY_PLAIN_SETTING");
    expect(keys).not.toContain("FOO_TOKEN");
    expect(keys).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(keys).not.toContain("DB_PASSWORD");
  });

  test("CONTEXT_MODE_ENV_PASSTHROUGH lets named variables through", async () => {
    process.env.CONTEXT_MODE_ENV_PASSTHROUGH = "FOO_TOKEN, DB_PASSWORD";
    const keys = await sandboxEnvKeys();
    expect(keys).toContain("FOO_TOKEN");
    expect(keys).toContain("DB_PASSWORD");
    expect(keys).not.toContain("AWS_SECRET_ACCESS_KEY");
  });
});
