import { afterEach, describe, expect, test } from "vitest";
import { redactSecrets } from "../src/redact.js";
import { ContentStore } from "../src/store.js";

describe("redactSecrets", () => {
  const cases: Array<[string, string, string]> = [
    ["Atlassian token", "jira key ATATT3xFfGF0abcdefghijklmnopqrstuv end", "ATATT3xFfGF0"],
    ["GitHub token", `use ghp_${"a1B2".repeat(9)} here`, "ghp_a1B2"],
    ["GitHub fine-grained PAT", `github_pat_${"x".repeat(30)} here`, "github_pat_xxx"],
    ["AWS key id", "id AKIAABCDEFGHIJKLMNOP here", "AKIAABCDEFGHIJKLMNOP"],
    ["Slack token", "xoxb-1234567890-abcdefghij here", "xoxb-1234567890"],
    ["URL credentials", "postgres://user:hunter2@db:5432/x", "hunter2"],
    ["JSON secret field", '{"jira_api_token": "abc"}', '"abc"'],
    ["env assignment", "JIRA_API_TOKEN=abc123", "abc123"],
    ["yaml password", "password: s3cr3t!", "s3cr3t!"],
    ["Azure account key", "DefaultEndpointsProtocol=https;AccountKey=Zm9vYmFy==;EndpointSuffix=x", "Zm9vYmFy"],
  ];

  test.each(cases)("%s", (_name, input, secret) => {
    const out = redactSecrets(input);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED]");
  });

  test("connection string keeps non-secret parts", () => {
    const out = redactSecrets("Server=x;Database=y;User Id=u;Password=p@ss;");
    expect(out).not.toContain("p@ss");
    expect(out).toContain("Server=x");
    expect(out).toContain("Database=y");
  });

  test("PEM private key block", () => {
    const pem = "before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nIBAAK\n-----END RSA PRIVATE KEY-----\nafter";
    const out = redactSecrets(pem);
    expect(out).not.toContain("MIIEow");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  test("Authorization header with JWT", () => {
    const out = redactSecrets("Authorization: Bearer eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2Q");
    expect(out).not.toContain("eyJhbGciOiJIUzI1");
    expect(out).toContain("Authorization: Bearer");
  });

  test("leaves ordinary text alone", () => {
    const text = "max_tokens: 100\nThe build passed in 4.2s with 0 warnings.";
    expect(redactSecrets(text)).toBe(text);
  });

  describe("CONTEXT_MODE_REDACT=off", () => {
    afterEach(() => { delete process.env.CONTEXT_MODE_REDACT; });
    test("disables redaction", () => {
      process.env.CONTEXT_MODE_REDACT = "off";
      expect(redactSecrets("JIRA_API_TOKEN=abc123")).toBe("JIRA_API_TOKEN=abc123");
    });
  });
});

describe("ContentStore redaction", () => {
  test("indexed secrets never reach the index", () => {
    const store = new ContentStore(":memory:");
    try {
      store.indexPlainText("deploy config for zephyrus\nJIRA_API_TOKEN=supersecretvalue42\n", "cfg");
      const hits = store.search("zephyrus");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.map((h) => h.content).join("\n")).toContain("[REDACTED]");
      expect(hits.map((h) => h.content).join("\n")).not.toContain("supersecretvalue42");
      expect(store.search("supersecretvalue42")).toEqual([]);
    } finally {
      store.close();
    }
  });
});
