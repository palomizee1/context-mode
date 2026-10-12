import { describe, expect, test } from "vitest";
import { buildShellScriptContent, windowsPathToPosix } from "../src/executor.js";

// Ported from upstream PR #1218 (issue #1217).
describe("Windows shell PATH restoration (#1217)", () => {
  test("windowsPathToPosix converts a drive-letter path", () => {
    expect(windowsPathToPosix("C:\\Program Files\\GitHub CLI")).toBe("/c/Program Files/GitHub CLI");
  });

  test("windowsPathToPosix lowercases the drive letter", () => {
    expect(windowsPathToPosix("D:\\tools")).toBe("/d/tools");
  });

  test("windowsPathToPosix falls back to a plain backslash swap for non-drive paths", () => {
    expect(windowsPathToPosix("\\\\server\\share")).toBe("//server/share");
  });

  test("appends the converted inherited PATH on win32", () => {
    const script = buildShellScriptContent("echo ok", "C:\\Program Files\\GitHub CLI;C:\\Windows\\system32", "win32");
    expect(script).toBe("export PATH=\"$PATH:\"'/c/Program Files/GitHub CLI:/c/Windows/system32'\necho ok");
  });

  test("keeps bash's own PATH on win32", () => {
    expect(buildShellScriptContent("echo ok", "C:\\Windows\\system32", "win32")).toMatch(/\$PATH/);
  });

  test("leaves the script unchanged when inheritedPath is empty on win32", () => {
    expect(buildShellScriptContent("echo ok", "", "win32")).toBe("echo ok");
  });

  test("POSIX behaviour is unchanged", () => {
    expect(buildShellScriptContent("echo ok", "/usr/bin:/bin", "darwin")).toBe("export PATH='/usr/bin:/bin'\necho ok");
  });
});
