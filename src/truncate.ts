/**
 * Surrogate-safe `str.slice(start, end)`. Widens `start` back by one code unit
 * when it would begin on the low half of a pair, and narrows `end` by one when
 * it would end on a high half, so the result never contains a lone surrogate.
 */
export function charSafeSlice(str: string, start: number, end = str.length): string {
  let s = Math.max(0, start);
  let e = Math.min(str.length, end);
  if (s > 0 && s < str.length) {
    const lo = str.charCodeAt(s);
    const hi = str.charCodeAt(s - 1);
    if (lo >= 0xdc00 && lo <= 0xdfff && hi >= 0xd800 && hi <= 0xdbff) s -= 1;
  }
  if (e > s && e < str.length) {
    const code = str.charCodeAt(e - 1);
    if (code >= 0xd800 && code <= 0xdbff) e -= 1;
  }
  return e > s ? str.slice(s, e) : "";
}

/** Return a UTF-16 prefix without splitting a surrogate pair. */
export function charSafePrefix(str: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (str.length <= maxChars) return str;
  let end = maxChars;
  const code = str.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return str.slice(0, end);
}
