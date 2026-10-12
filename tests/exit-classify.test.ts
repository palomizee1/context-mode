import { describe, expect, test } from "vitest";
import { classifyNonZeroExit } from "../src/exit-classify.js";

describe("classifyNonZeroExit", () => {
  test("shell exit 1 with stdout and no stderr is a soft failure (grep no-match style)", () => {
    const result = classifyNonZeroExit({ language: "shell", exitCode: 1, stdout: "a.ts:1: x\n", stderr: "" });
    expect(result.isError).toBe(false);
    expect(result.output).toBe("a.ts:1: x\n");
  });

  // Upstream PR #1250
  test("shell exit 1 with partial stdout and stderr is a real error", () => {
    const result = classifyNonZeroExit({
      language: "shell",
      exitCode: 1,
      stdout: "partial result\n",
      stderr: "operation failed\n",
    });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Exit code: 1");
    expect(result.output).toContain("partial result");
    expect(result.output).toContain("operation failed");
  });

  test("shell exit 1 with empty stdout is a real error", () => {
    expect(classifyNonZeroExit({ language: "shell", exitCode: 1, stdout: "", stderr: "" }).isError).toBe(true);
  });

  test("non-shell exit 1 is a real error", () => {
    expect(classifyNonZeroExit({ language: "javascript", exitCode: 1, stdout: "x", stderr: "" }).isError).toBe(true);
  });
});
