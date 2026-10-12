import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { walkDirectoryDetailed, type WalkOptions } from "../src/store-directory.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function makeRoot(prefix: string, files: string[]): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  for (const file of files) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), "content");
  }
  return root;
}

function walk(root: string, opts: WalkOptions = {}): string[] {
  return walkDirectoryDetailed(root, opts).files.map((f) => relative(root, f).replaceAll("\\", "/")).sort();
}

// Ported from upstream PR #1291.
describe("directory walk globstar boundaries", () => {
  const fixture = () => makeRoot("ctx-globstar-", ["docs/top.md", "docs/nested/deep.md", "docs/nested/deeper/leaf.md", "other.md"]);

  test("globstar between path segments matches zero or more directories", () => {
    expect(walk(fixture(), { include: ["docs/**/*.md"] })).toEqual(["docs/nested/deep.md", "docs/nested/deeper/leaf.md", "docs/top.md"]);
  });

  test("globstar exclusions include the directly nested file", () => {
    expect(walk(fixture(), { exclude: ["docs/**/*.md"] })).toEqual(["other.md"]);
  });

  test("single-star filters still stay within one directory", () => {
    expect(walk(fixture(), { include: ["docs/*.md"] })).toEqual(["docs/top.md"]);
  });

  test("literal metacharacters and question marks keep their glob meanings", () => {
    const root = fixture();
    writeFileSync(join(root, "docs", "[notes].md"), "content");
    expect(walk(root, { include: ["docs/[notes].md"] })).toHaveLength(1);
    expect(walk(root, { include: ["docs/to?.md"] })).toHaveLength(1);
    expect(walk(root, { include: ["docs/???.md"] })).toHaveLength(1);
  });

  test("terminal globstar still crosses directory separators", () => {
    expect(walk(fixture(), { include: ["docs/**"] })).toHaveLength(3);
  });

  test("question marks preserve UTF-16 code-unit matching", () => {
    const root = fixture();
    writeFileSync(join(root, "docs", "😀.md"), "content");
    expect(walk(root, { include: ["docs/?.md"] })).toHaveLength(0);
    expect(walk(root, { include: ["docs/??.md"] })).toHaveLength(1);
  });
});

// Ported from upstream PR #1292.
describe("directory walk nested .gitignore scopes", () => {
  const fixture = () => {
    const root = makeRoot("ctx-ignore-", [
      "docs/private.md", "docs/public.md", "other/private.md",
      "docs/nested/private.md", "docs/nested/root-ignore.md", "other/root-ignore.md",
    ]);
    writeFileSync(join(root, ".gitignore"), "root-ignore.md\n");
    writeFileSync(join(root, "docs", ".gitignore"), "private.md\n");
    return root;
  };

  test("nested gitignore rules apply to their own subtree", () => {
    expect(walk(fixture())).toEqual(["docs/public.md", "other/private.md"]);
  });

  test("root gitignore rules remain inherited by nested directories", () => {
    expect(walk(fixture()).some((file) => file.endsWith("root-ignore.md"))).toBe(false);
  });

  test("respectGitignore false disables root and nested rules", () => {
    expect(walk(fixture(), { respectGitignore: false }).filter((f) => f.endsWith(".md"))).toHaveLength(6);
  });
});

// Ported from upstream PR #1294.
describe("directory walk symlink containment", () => {
  const linkType = process.platform === "win32" ? "junction" : "dir";

  test("a contained symlink target beginning with two dots is followed", () => {
    const root = makeRoot("ctx-dot-link-", ["..notes/content.md"]);
    symlinkSync(join(root, "..notes"), join(root, "alias"), linkType);
    expect(walk(root, { followSymlinks: true, include: ["alias/*.md"] })).toEqual(["alias/content.md"]);
  });

  test("a parent-directory symlink remains rejected", () => {
    const root = makeRoot("ctx-parent-link-", ["outside.md", "project/keep.md"]);
    symlinkSync(root, join(root, "project", "alias"), linkType);
    expect(walk(join(root, "project"), { followSymlinks: true, include: ["alias/*.md"] })).toEqual([]);
  });
});
