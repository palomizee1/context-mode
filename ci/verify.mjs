// End-to-end hardening checks: drives server.bundle.mjs over stdio and prints PASS/FAIL per check.
// Usage: pnpm build && pnpm verify
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.argv[2] ?? join(import.meta.dirname, "..");
const BUNDLE = join(REPO, "server.bundle.mjs");
const results = [];
const record = (id, check, pass, detail = "") => results.push({ id, check, pass, detail });

function rpc(id, name, args) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

// Run one server process, send calls in order, return {id: text}.
function session(env, calls, { cwd = tmpdir(), settleMs = 400 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BUNDLE], { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const pending = new Map();
    child.stdout.on("data", (d) => {
      out += d;
      let nl;
      while ((nl = out.indexOf("\n")) >= 0) {
        const line = out.slice(0, nl);
        out = out.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        pending.get(msg.id)?.(msg);
      }
    });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    const send = (msg) => new Promise((res) => {
      if (msg.id !== undefined) pending.set(msg.id, res);
      child.stdin.write(JSON.stringify(msg) + "\n");
      if (msg.id === undefined) res();
    });
    (async () => {
      await send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify", version: "1" } } });
      await send({ jsonrpc: "2.0", method: "notifications/initialized" });
      const texts = {};
      for (const [i, call] of calls.entries()) {
        const msg = await send(rpc(i + 1, call[0], call[1]));
        texts[i + 1] = (msg.result?.content ?? []).map((c) => c.text).join("\n") || JSON.stringify(msg.error ?? msg.result);
      }
      await new Promise((r) => setTimeout(r, settleMs));
      child.kill("SIGTERM");
      child.on("exit", () => resolve({ texts, stderr: err }));
    })().catch(reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── R1 / R4 ephemeral: index something, nothing lands on disk ────────────────
const project = mkdtempSync(join(tmpdir(), "ctx-verify-proj-"));
const stateHome = mkdtempSync(join(tmpdir(), "ctx-verify-state-"));
{
  const { texts } = await session(
    { XDG_STATE_HOME: stateHome, CONTEXT_MODE_PROJECT_DIR: project },
    [["ctx_index", { content: "ephemeral verification marmalade", source: "v" }], ["ctx_search", { queries: ["marmalade"] }]],
  );
  record("R4", "Ephemeral default: index + search works", texts[2].includes("marmalade"));
  const contentDir = join(stateHome, "context-mode", "content");
  const files = existsSync(contentDir) ? readdirSync(contentDir) : [];
  record("R4", "Ephemeral default: no DB file written", files.length === 0, files.join(","));
  record("R1", "No content under ~/.claude", !existsSync(join(homedir(), ".claude", "context-mode")));
}

// ── R4 persist TTL ────────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), "ctx-verify-persist-"));
  const env = { CONTEXT_MODE_INDEX: "persist", CONTEXT_MODE_DIR: dir, CONTEXT_MODE_PROJECT_DIR: project };
  await session(env, [["ctx_index", { content: "persisted pomegranate", source: "p" }]]);
  const dbs = readdirSync(join(dir, "content")).filter((n) => n.endsWith(".db"));
  record("R4", "Persist: DB written to CONTEXT_MODE_DIR", dbs.length === 1, dbs.join(","));
  const kept = await session({ ...env }, [["ctx_search", { queries: ["pomegranate"] }]]);
  record("R4", "Persist: found again within TTL after restart", kept.texts[1].includes("pomegranate"));
  await sleep(2_500);
  const gone = await session({ ...env, CONTEXT_MODE_TTL_HOURS: "0.0002" }, [["ctx_search", { queries: ["pomegranate"] }]]);
  record("R4", "Persist: gone after TTL on restart", !gone.texts[1].includes("pomegranate"), gone.texts[1].slice(0, 80));

  // Quarantine sweep at startup
  const fake = join(dir, "content", "x.db.corrupt-1");
  writeFileSync(fake, "full tool output");
  await session(env, []);
  record("R4", "Persist: corrupt-DB quarantine copy swept at startup", !existsSync(fake));
  rmSync(dir, { recursive: true, force: true });
}

// ── Redaction / env ───────────────────────────────────────────────────────────
{
  const { texts } = await session(
    { CONTEXT_MODE_PROJECT_DIR: project, FAKE_SERVICE_TOKEN: "x", FAKE_DB_PASSWORD: "x" },
    [
      ["ctx_index", { content: "redaction quince\nkey ATATT3xFfGF0abcdefghijklmnopqrstuv\nServer=x;Password=hunter2;", source: "r" }],
      ["ctx_search", { queries: ["redaction quince"] }],
      ["ctx_execute", { language: "javascript", code: "console.log(JSON.stringify(Object.keys(process.env).filter(k=>/TOKEN|SECRET|PASSWORD/.test(k))))" }],
    ],
  );
  record("Redact", "Secrets stored as [REDACTED]", texts[2].includes("[REDACTED]") && !texts[2].includes("hunter2") && !texts[2].includes("ATATT3x"));
  record("Env", "Sandbox sees no secret-named env vars", texts[3].trim() === "[]", texts[3].trim());
}

// ── #1075 deny rule with // anchor ────────────────────────────────────────────
{
  const secret = join(project, "secret.txt");
  writeFileSync(secret, "top secret content");
  mkdirSync(join(project, ".claude"), { recursive: true });
  writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ permissions: { deny: [`Read(/${secret})`] } }));
  const { texts } = await session(
    { CONTEXT_MODE_PROJECT_DIR: project },
    [["ctx_execute_file", { path: secret, language: "javascript", code: "console.log(FILE_CONTENT)" }]],
  );
  record("#1075", "Deny rule Read(//abs/path) blocks ctx_execute_file", !texts[1].includes("top secret content"), texts[1].slice(0, 100));
}

// ── Auth: HTTP refuses to start without a token ──────────────────────────────
{
  const env = { ...process.env };
  delete env.CONTEXT_MODE_HTTP_TOKEN;
  const r = spawnSync(process.execPath, [BUNDLE, "--transport", "http"], { env, timeout: 10_000 });
  record("Auth", "HTTP without token exits with code 2", r.status === 2, `status ${r.status}`);
}

// ── R6: starts and serves with outbound network denied (macOS sandbox) ───────
if (process.platform === "darwin") {
  const profile = "(version 1)(allow default)(deny network-outbound (remote ip))";
  const msgs = [
    { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "v", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    rpc(1, "ctx_doctor", {}),
  ].map((m) => JSON.stringify(m)).join("\n") + "\n";
  const r = spawnSync("sandbox-exec", ["-p", profile, process.execPath, BUNDLE], { input: msgs, timeout: 8_000, env: { ...process.env, CONTEXT_MODE_PROJECT_DIR: project } });
  const out = String(r.stdout);
  record("R6", "Starts and serves with outbound network denied", out.includes("[OK] FTS5 / SQLite: PASS"), r.error ? String(r.error) : "");
}

// ── R2 / R5 / R6 static ───────────────────────────────────────────────────────
{
  const g = spawnSync("bash", [join(REPO, "ci", "guard.sh")]);
  record("R2/R5/R6", "Guard script passes", g.status === 0, String(g.stdout).trim());
  const bundleHits = spawnSync("grep", ["-cE", "registry\\.npmjs\\.org|platform_url|npm install", BUNDLE]);
  record("R2/R5/R6", "Bundle has no registry/forwarder/npm install strings", String(bundleHits.stdout).trim() === "0", `matches ${String(bundleHits.stdout).trim()}`);
}

rmSync(project, { recursive: true, force: true });
rmSync(stateHome, { recursive: true, force: true });

for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.id} | ${r.check}${r.detail ? ` | ${r.detail}` : ""}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
