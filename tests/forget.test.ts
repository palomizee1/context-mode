import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { closeProjectStore } from "../src/project-context.js";
import { REGISTERED_CTX_TOOLS, withProjectDirOverride } from "../src/server.js";

// Ported from upstream PR #939.
describe("ctx_forget", () => {
  const tool = (name: string) => REGISTERED_CTX_TOOLS.find((t) => t.name === name)!;
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      closeProjectStore(root);
      rmSync(root, { recursive: true, force: true });
    }
  });

  async function setup() {
    const root = mkdtempSync(join(tmpdir(), "context-mode-forget-"));
    roots.push(root);
    const call = (name: string, args: Record<string, unknown>) =>
      withProjectDirOverride(root, () => tool(name).handler(args)) as Promise<{ isError?: boolean; content: Array<{ text: string }> }>;
    await call("ctx_index", { content: "alpha apricot", source: "alpha" });
    await call("ctx_index", { content: "beta blueberry", source: "beta" });
    return call;
  }

  test("lists sources when no source is given", async () => {
    const call = await setup();
    const text = (await call("ctx_forget", {})).content[0]!.text;
    expect(text).toContain("alpha (1 chunk)");
    expect(text).toContain("beta (1 chunk)");
  });

  test("requires confirm before deleting", async () => {
    const call = await setup();
    expect((await call("ctx_forget", { source: "alpha" })).content[0]!.text).toContain("Cancelled");
    expect((await call("ctx_search", { queries: ["apricot"] })).content[0]!.text).toContain("apricot");
  });

  test("deletes only the named source", async () => {
    const call = await setup();
    expect((await call("ctx_forget", { source: "alpha", confirm: true })).content[0]!.text).toContain("removed 1 chunk");
    expect((await call("ctx_search", { queries: ["apricot"], source: "alpha" })).content[0]!.text).not.toContain("alpha apricot");
    expect((await call("ctx_search", { queries: ["blueberry"] })).content[0]!.text).toContain("blueberry");
  });

  test("an unknown source is an error that lists what exists", async () => {
    const call = await setup();
    const result = await call("ctx_forget", { source: "nope", confirm: true });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("beta");
  });
});
