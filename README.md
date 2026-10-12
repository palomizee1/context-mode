# context-mode (hardened fork)

A hardened, personal-use fork of [mksglu/context-mode](https://github.com/mksglu/context-mode), built on
[ilkerozgedik/context-mode](https://github.com/ilkerozgedik/context-mode) @ `d2a3dbd`.

It keeps the useful part, an MCP server that runs commands and indexes large output into local full-text
search so raw output stays out of the model's context, and removes everything that made upstream unsafe to
run on a real machine. See [NOTICE.md](NOTICE.md) for licensing and attribution.

## Hardened fork

### Removed or fixed

| Upstream risk | Status here |
|---|---|
| Silently writes `~/.claude/settings.json`, hooks and plugin registries | Removed (no hooks, no `start.mjs`). Nothing is written under `~/.claude`. |
| Unpinned `npm install` at runtime | Removed. Built from the committed `pnpm-lock.yaml`. |
| PreToolUse hooks that rewrite or block tool calls | Removed. Routing is advisory, via CLAUDE.md. |
| Tool output kept on disk, unencrypted, for days (forever in the base fork) | In-memory index by default; opt-in on-disk mode has a TTL and a stale-file sweep. |
| Dormant event forwarder to a third-party URL | Removed. |
| Update check against the npm registry on every start | Removed. |
| Loopback HTTP transport with no auth | HTTP refuses to start without a bearer token. |
| Secrets in indexed output | Redacted before indexing (best effort). |
| Sandbox inherits `GITHUB_TOKEN`, `*_API_KEY`, etc. | Secret-named env vars are stripped unless passed through. |
| Permission deny rules with `//` or `~/` anchors fail open (#1075) | Fixed. |

| better-sqlite3 native addon (install-time binary download, node-gyp fallback) | Replaced by Node's built-in `node:sqlite`. No native modules; the only runtime dependency is turndown (pure JS, used by `ctx_fetch_and_index`). |

`ci/guard.sh` (also `pnpm guard`) fails CI if any of the removed behaviours come back.

### Environment variables

| Variable | Default | Effect |
|---|---|---|
| `CONTEXT_MODE_INDEX` | `ephemeral` | `ephemeral` keeps each project index in SQLite `:memory:`. `persist` writes it to disk. |
| `CONTEXT_MODE_TTL_HOURS` | `24` | Persist mode: sources older than this are dropped when a store opens; stale DB files and corrupt-DB copies are deleted at startup. |
| `CONTEXT_MODE_DIR` | `$XDG_STATE_HOME/context-mode` (`~/.local/state/context-mode`; `%LOCALAPPDATA%\context-mode` on Windows) | Persist mode storage root (absolute path). |
| `CONTEXT_MODE_HTTP_TOKEN` | unset | Required (32+ chars) for `--transport http`; clients send `Authorization: Bearer <token>`. |
| `CONTEXT_MODE_TOOLS` | all | Comma-separated allow-list of tools to expose. |
| `CONTEXT_MODE_ENV_PASSTHROUGH` | unset | Comma-separated secret-named env vars that sandboxed code may still see. |
| `CONTEXT_MODE_DEFAULT_TIMEOUT_MS` | unset (no timeout, see upstream #406) | Timeout for executions that don't pass one. |
| `CONTEXT_MODE_REDACT` | on | `off` disables secret redaction of indexed content. |

### Upstream PRs ported

| PR | Change | Author |
|---|---|---|
| [#1087](https://github.com/mksglu/context-mode/pull/1087) | Expand `//` and `~/` anchors in permission patterns (fixes #1075) | @meikocho1 |
| [#1250](https://github.com/mksglu/context-mode/pull/1250) | Shell exit 1 with stderr counts as an error | @agammann |
| [#1218](https://github.com/mksglu/context-mode/pull/1218) | Restore inherited PATH for Windows shell scripts (fixes #1217) | @fl4pj4ck |
| [#1286](https://github.com/mksglu/context-mode/pull/1286) | Survive a deleted project dir; strip `FORCE_COLOR` | @Kenmege |
| [#1176](https://github.com/mksglu/context-mode/pull/1176) | Surrogate-safe snippet truncation (fixes #1163) | @xecanto |
| [#1030](https://github.com/mksglu/context-mode/pull/1030) | Retry transient `SQLITE_IOERR` | @halindrome |
| [#1076](https://github.com/mksglu/context-mode/pull/1076) | `CONTEXT_MODE_TOOLS` allow-list (fixes #1031) | @alaleiwang |
| [#968](https://github.com/mksglu/context-mode/pull/968) | Opt-in default exec timeout (fixes #936) | @hakanbaysal |
| [#1230](https://github.com/mksglu/context-mode/pull/1230) | Accept a singular `query` in `ctx_search` (fixes #1200) | @JoAdo07 |

[#970](https://github.com/mksglu/context-mode/pull/970) (14-day session retention) is superseded by the TTL
and sweep above.

## Install in Claude Code

```bash
pnpm install --frozen-lockfile
pnpm build
claude mcp add --scope user context-mode \
  -e CONTEXT_MODE_INDEX=ephemeral \
  -e CONTEXT_MODE_TOOLS=ctx_execute,ctx_execute_file,ctx_batch_execute,ctx_index,ctx_search,ctx_doctor,ctx_purge \
  -- "$(which node)" "$PWD/server.bundle.mjs"
```

`ctx_fetch_and_index` is left out of that allow-list so the server makes no outbound requests; add it back if
you want it. Without hooks, Claude uses the tools when told to, so add guidance to `~/.claude/CLAUDE.md`, for
example:

```markdown
## context-mode MCP
- For commands whose output may be large (test suites, builds, log scans, git log/diff over many files),
  use `mcp__context-mode__ctx_execute` / `ctx_batch_execute` with an `intent` instead of Bash, then
  `ctx_search` for details. Use Bash for short commands.
```

## Runtime

```bash
# Local MCP clients (what Claude Code uses)
context-mode --transport stdio

# Standalone Streamable HTTP server (requires CONTEXT_MODE_HTTP_TOKEN)
context-mode --transport http --host 127.0.0.1 --port 3050
```

The HTTP endpoint is `/mcp`; liveness is at `/healthz` and readiness at `/readyz`. HTTP mode is restricted to
loopback, validates Host and Origin headers, and requires the bearer token on `/mcp`.

Both MCP revision `2026-07-28` and 2025-era clients are served: stdio uses the SDK's `legacy: "serve"`, HTTP
uses stateless per-request serving.

## Tool surface

- `ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`: run JavaScript, Python or shell and keep only the
  useful output.
- `ctx_index`, `ctx_search`: index content and search it with SQLite FTS5 (BM25).
- `ctx_fetch_and_index`: fetch URLs (with SSRF defences), index them, return a preview.
- `ctx_doctor`: health report.
- `ctx_purge`: delete this project's index; needs `confirm: true`.

Calls to the same project may run concurrently; execution preserves request-scoped cwd and cancellation. Child
processes inherit the server's OS permissions and are terminated when the request is cancelled or the server
shuts down. `ctx_batch_execute` accepts at most eight commands with bounded output capture.

## Development

Requires Node.js `^22.16.0 || >=24`: the first official builds whose `node:sqlite` includes FTS5 (22.13–22.15
and all of 23.x lack it). `ctx_doctor` checks it.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build   # typecheck + bundle
pnpm guard
pnpm verify  # end-to-end hardening checks against the built bundle
```

`server.bundle.mjs` is the committed runtime artifact; CI checks it is up to date.
