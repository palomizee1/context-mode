import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { closeProjectStore } from "../src/project-context.js";
import { REGISTERED_CTX_TOOLS, withProjectDirOverride } from "../src/server.js";

// Ported from upstream PR #1230 (issue #1200).
describe("ctx_search singular query alias", () => {
  const search = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_search")!;
  const index = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_index")!;

  test("schema accepts { query }", () => {
    const schema = search.config.inputSchema as { safeParse: (v: unknown) => { success: boolean } };
    expect(schema.safeParse({ query: "x" }).success).toBe(true);
    expect(schema.safeParse({ queries: ["x"] }).success).toBe(true);
  });

  test("{ query } searches like { queries: [query] }", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-mode-alias-"));
    try {
      await withProjectDirOverride(root, () => index.handler({ content: "alias tangerine", source: "a" }));
      const result = await withProjectDirOverride(root, () => search.handler({ query: "tangerine" })) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).not.toBe(true);
      expect(result.content[0]?.text).toContain("tangerine");
    } finally {
      closeProjectStore(root);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("neither query shape is an error", async () => {
    const result = await search.handler({}) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });
});
