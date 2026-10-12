import { describe, expect, test } from "vitest";
import {
  createContextModeHttpHandler,
  createContextModeNodeHttpServer,
  createContextModeServer,
} from "../src/server.js";

const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "context-mode-test", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

function modernRequest(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:3050/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, _meta: MODERN_META },
    }),
  });
}

describe("standalone MCP HTTP server", () => {
  test("creates a fresh MCP server for every request", () => {
    expect(createContextModeServer()).not.toBe(createContextModeServer());
  });

  test("serves 2026-07-28 server/discover without a session id", async () => {
    const handler = createContextModeHttpHandler();
    const response = await handler.fetch(modernRequest("server/discover"));
    const body = await response.json() as { result?: { supportedVersions?: string[]; resultType?: string; ttlMs?: number; cacheScope?: string; _meta?: Record<string, unknown> } };

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect(body.result?.supportedVersions).toContain("2026-07-28");
    expect(body.result?.resultType).toBe("complete");
    expect(body.result?.ttlMs).toBeTypeOf("number");
    expect(body.result?.cacheScope).toBe("private");
    expect(body.result?._meta?.["io.modelcontextprotocol/serverInfo"]).toBeDefined();
  });

  test("serves 2025-era initialize requests statelessly", async () => {
    const handler = createContextModeHttpHandler();
    const response = await handler.fetch(new Request("http://127.0.0.1:3050/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "legacy-test", version: "1" },
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect(await response.text()).toContain('"protocolVersion":"2025-11-25"');
  });

  test("rejects modern requests missing mandatory protocol headers", async () => {
    const handler = createContextModeHttpHandler();
    const request = modernRequest("server/discover");
    request.headers.delete("mcp-protocol-version");
    const response = await handler.fetch(request);
    const body = await response.json() as { error?: { code?: number } };

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe(-32020);
  });
  test("rejects a modern request when Mcp-Method is missing", async () => {
    const handler = createContextModeHttpHandler();
    const request = modernRequest("server/discover");
    request.headers.delete("mcp-method");
    const response = await handler.fetch(request);
    const body = await response.json() as { error?: { code?: number } };

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe(-32020);
  });

  test("serves a modern tools/call with Mcp-Name", async () => {
    const handler = createContextModeHttpHandler();
    const response = await handler.fetch(modernRequest(
      "tools/call",
      { name: "ctx_doctor", arguments: {} },
      { "mcp-name": "ctx_doctor" },
    ));
    const body = await response.json() as { result?: { resultType?: string; content?: Array<{ text?: string }> } };

    expect(response.status).toBe(200);
    expect(body.result?.resultType).toBe("complete");
    expect(body.result?.content?.[0]?.text).toContain("context-mode doctor");
  });

  test("CONTEXT_MODE_TOOLS limits the tools that are exposed", async () => {
    const saved = process.env.CONTEXT_MODE_TOOLS;
    process.env.CONTEXT_MODE_TOOLS = "ctx_search, ctx_execute";
    try {
      const response = await createContextModeHttpHandler().fetch(modernRequest("tools/list"));
      const body = await response.json() as { result?: { tools?: Array<{ name: string }> } };
      expect(body.result?.tools?.map((tool) => tool.name)).toEqual(["ctx_execute", "ctx_search"]);
    } finally {
      if (saved === undefined) delete process.env.CONTEXT_MODE_TOOLS;
      else process.env.CONTEXT_MODE_TOOLS = saved;
    }
  });

  test("serves deterministic modern tools/list metadata", async () => {
    const handler = createContextModeHttpHandler();
    const response = await handler.fetch(modernRequest("tools/list"));
    const body = await response.json() as { result?: { resultType?: string; ttlMs?: number; cacheScope?: string; tools?: Array<{ name: string }> } };
    const names = body.result?.tools?.map((tool) => tool.name) ?? [];

    expect(response.status).toBe(200);
    expect(body.result?.resultType).toBe("complete");
    expect(body.result?.ttlMs).toBeTypeOf("number");
    expect(body.result?.cacheScope).toBe("private");
    expect(names).toEqual([
      "ctx_execute",
      "ctx_execute_file",
      "ctx_index",
      "ctx_search",
      "ctx_fetch_and_index",
      "ctx_batch_execute",
      "ctx_doctor",
      "ctx_forget",
      "ctx_purge",
    ]);
  });

  test("separates readiness from MCP and liveness routes", async () => {
    const server = createContextModeNodeHttpServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing test server address");
      const response = await fetch(`http://127.0.0.1:${address.port}/readyz`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "ready" });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  describe("bearer token on /mcp", () => {
    const TOKEN = "t".repeat(40);
    const initBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "auth-test", version: "1" } },
    });

    async function withServer(token: string, fn: (base: string) => Promise<void>) {
      const server = createContextModeNodeHttpServer(createContextModeHttpHandler(), token);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("missing test server address");
        await fn(`http://127.0.0.1:${address.port}`);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }

    function post(base: string, authorization?: string) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      };
      if (authorization) headers.authorization = authorization;
      return fetch(`${base}/mcp`, { method: "POST", headers, body: initBody });
    }

    test("rejects a missing token", async () => {
      await withServer(TOKEN, async (base) => {
        expect((await post(base)).status).toBe(401);
      });
    });

    test("rejects a wrong token", async () => {
      await withServer(TOKEN, async (base) => {
        expect((await post(base, `Bearer ${"x".repeat(40)}`)).status).toBe(401);
      });
    });

    test("accepts the correct token", async () => {
      await withServer(TOKEN, async (base) => {
        expect((await post(base, `Bearer ${TOKEN}`)).status).toBe(200);
      });
    });

    test("rejects everything when no token is configured", async () => {
      await withServer("", async (base) => {
        expect((await post(base, "Bearer ")).status).toBe(401);
        expect((await post(base, `Bearer ${TOKEN}`)).status).toBe(401);
      });
    });
  });

});
