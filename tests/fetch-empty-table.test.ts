import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildFetchCode } from "../src/fetch.js";

// Ported from upstream PR #1138: turndown-plugin-gfm threw on a <table> with no rows.
describe("fetch HTML conversion of tables without rows", () => {
  // Run the generated subprocess code's turndown setup against local HTML by
  // swapping the network fetch for a stub response.
  async function convert(html: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "ctx-fetch-table-"));
    try {
      const out = join(dir, "out.txt");
      const code = buildFetchCode("https://example.invalid/", out);
      const stub = `globalThis.fetch = async () => new Response(${JSON.stringify(html)}, { headers: { "content-type": "text/html" } });\n`;
      const script = join(dir, "run.cjs");
      writeFileSync(script, stub + code);
      const { spawnSync } = await import("node:child_process");
      const r = spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env } });
      return r.stdout + r.stderr + (await import("node:fs")).readFileSync(out, "utf8");
    } catch (err) {
      return String(err);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("generated code registers the empty-table rule", () => {
    expect(buildFetchCode("https://example.invalid/", "/tmp/x")).toContain("emptyTable");
  });

  test("content around an empty table survives", async () => {
    const out = await convert("<p>Before</p><table></table><p>After</p>");
    expect(out).toContain("Before");
    expect(out).toContain("After");
  });

  test("a caption-only table keeps its text", async () => {
    expect(await convert("<table><caption>Summary</caption></table>")).toContain("Summary");
  });
});
