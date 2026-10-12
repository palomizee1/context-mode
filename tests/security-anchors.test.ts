import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { evaluateFilePath, evaluateProjectContainment, expandGlobAnchors } from "../src/security.js";

// Ported from upstream PR #1087 (issue #1075).
describe("permission pattern anchors (#1075)", () => {
  const home = homedir().replace(/\\/g, "/");
  const projectRoot = resolve(tmpdir(), "ctx-anchor-project");

  test("// resolves to the filesystem root", () => {
    expect(expandGlobAnchors("//etc/passwd")).toEqual(["//etc/passwd", "/etc/passwd"]);
  });

  test("~/ resolves to the home directory", () => {
    const [raw, expanded] = expandGlobAnchors("~/.ssh/id_rsa");
    expect(raw).toBe("~/.ssh/id_rsa");
    expect(expanded.replace(/\\/g, "/")).toBe(`${home}/.ssh/id_rsa`);
  });

  test("unanchored globs are returned untouched", () => {
    expect(expandGlobAnchors("**/.env")).toEqual(["**/.env"]);
    expect(expandGlobAnchors("/src/**")).toEqual(["/src/**"]);
  });

  test("deny: // rule blocks the absolute path it names", () => {
    expect(evaluateFilePath("/etc/passwd", [["//etc/passwd"]], false)).toEqual({
      denied: true,
      matchedPattern: "//etc/passwd",
    });
  });

  test("deny: ~/ rule blocks the home-relative path it names", () => {
    expect(evaluateFilePath(`${home}/.ssh/id_rsa`, [["~/.ssh/**"]], false)).toEqual({
      denied: true,
      matchedPattern: "~/.ssh/**",
    });
  });

  test("deny: anchored rules do not match unrelated paths", () => {
    expect(evaluateFilePath("/etc/hosts", [["//etc/passwd"]], false).denied).toBe(false);
    expect(evaluateFilePath(`${home}/notes/todo.md`, [["~/.ssh/**"]], false).denied).toBe(false);
  });

  test("allow: ~/ rule lets an out-of-project read through", () => {
    const target = `${home}/logs/app.log`;
    expect(evaluateProjectContainment(target, projectRoot, [], false).allowed).toBe(false);
    expect(evaluateProjectContainment(target, projectRoot, [["~/logs/**"]], false)).toEqual({
      allowed: true,
      reason: "allow-rule",
    });
  });

  test("allow: // rule lets an out-of-project read through", () => {
    expect(evaluateProjectContainment("/var/log/system.log", projectRoot, [["//var/log/**"]], false)).toEqual({
      allowed: true,
      reason: "allow-rule",
    });
  });
});
