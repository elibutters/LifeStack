import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { handleMcp } from "@/lib/mcp-http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Stateless MCP over HTTP: one fresh server per request, so nothing is kept between requests.
export const POST = (req: Request) => handleMcp(req, WebStandardStreamableHTTPServerTransport);
const notAllowed = () => new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { allow: "POST", "content-type": "application/json" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
