import { describe, expect, test } from "vitest";
import { extractSnippet } from "../src/search-format.js";
import { charSafeSlice } from "../src/truncate.js";

// Ported from upstream PR #1176 (issue #1163): a lone surrogate in a tool
// result makes the API reject the request, wedging the session on HTTP 500.
const hasLoneSurrogate = (s: string) =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe("charSafeSlice", () => {
  test("start inside a pair widens to include the whole character", () => {
    expect(charSafeSlice("ab\u{1F916}cd", 3)).toBe("\u{1F916}cd");
  });

  test("end inside a pair drops the stranded high half", () => {
    expect(charSafeSlice("ab\u{1F916}cd", 0, 3)).toBe("ab");
  });

  test("ASCII behaves like String.slice", () => {
    expect(charSafeSlice("hello world", 2, 7)).toBe("hello world".slice(2, 7));
  });

  test("never yields a lone surrogate for any cut on emoji-dense text", () => {
    const s = "x\u{1F916}y\u{1F600}\u{1F680}z".repeat(5);
    for (let a = 0; a <= s.length; a++) {
      for (let b = a; b <= s.length; b++) {
        expect(hasLoneSurrogate(charSafeSlice(s, a, b))).toBe(false);
      }
    }
  });
});

describe("extractSnippet surrogate safety (#1163)", () => {
  test("window start landing mid-emoji does not strand the low half", () => {
    const q = "scope";
    const content = "x".repeat(800) + "\u{1F916}" + "a".repeat(299) + q + " y".repeat(50);
    expect(content.indexOf(q) - 300).toBe(content.indexOf("\u{1F916}") + 1);
    const snippet = extractSnippet(content, q, 500);
    expect(hasLoneSurrogate(snippet)).toBe(false);
    expect(snippet).toContain("\u{1F916}");
  });

  test("no window boundary on emoji-dense content yields a lone surrogate", () => {
    const content = "\u{1F916}z".repeat(1200) + " needle " + "\u{1F600}".repeat(600);
    for (let maxLen = 100; maxLen < 700; maxLen += 7) {
      expect(hasLoneSurrogate(extractSnippet(content, "needle", maxLen))).toBe(false);
    }
  });

  test("no-match prefix path does not end on a high surrogate", () => {
    const content = "a" + "\u{1F916}".repeat(1000);
    expect(hasLoneSurrogate(extractSnippet(content, "zzz-no-match", 100))).toBe(false);
  });
});
