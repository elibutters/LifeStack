import "server-only";
import type { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer } from "./mcp";
import { verifyBearer } from "./tokens";

// /api/v1/ skips the session gate in proxy.ts, so this authenticates itself and fails closed.
const MAX_BODY = 32 * 1024;
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function handleMcp(req: Request, Transport: typeof WebStandardStreamableHTTPServerTransport): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"));
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return json({ error: "too_large" }, 413);
  // Agents are not browsers: refuse cross-site browser requests outright.
  if (req.headers.get("origin")) return json({ error: "forbidden" }, 403);

  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "too_large" }, 413);

  const server = buildServer(auth.token);
  const transport = new Transport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(new Request(req.url, { method: "POST", headers: req.headers, body: text }));
  } finally {
    await server.close();
  }
}
