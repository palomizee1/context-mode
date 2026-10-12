# Notice

This is a modified version of context-mode by Mert Koseoglu (<https://github.com/mksglu/context-mode>),
licensed under the Elastic License 2.0 (see [LICENSE](LICENSE)), incorporating changes from
<https://github.com/ilkerozgedik/context-mode>.

Modifications by palomizee1, 2026: accept 2025-era MCP clients; require a bearer token for the HTTP
transport; store content outside `~/.claude`; in-memory index by default with a TTL and stale-file sweep for
on-disk mode; redact secrets before indexing; strip secret-named environment variables from sandboxed code;
port of upstream pull requests #1087, #1250, #1218, #1286, #1176, #1030, #1076, #968 and #1230 (credited in
the README and commit messages); guard script and CI.

This fork is for personal use. It is not offered as a hosted or managed service and is not published to npm.
