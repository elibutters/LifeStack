import { createServer } from "node:http";
import { sql } from "drizzle-orm";
import { createDb } from "@lifestack/db";

// M0 skeleton: a health endpoint only. M4 replaces this with the MCP server
// (Streamable HTTP) exposing query_events, get_today, get_week_summary,
// list_tasks / upsert_task, log_event and run_sql.
const { db } = createDb();
const port = Number(process.env.PORT ?? 3001);

createServer(async (req, res) => {
  if (req.url !== "/health") {
    res.writeHead(404).end();
    return;
  }
  try {
    await db.execute(sql`select 1`);
    res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
  } catch {
    res.writeHead(503, { "content-type": "application/json" }).end('{"ok":false}');
  }
}).listen(port, () => console.log(`mcp: listening on ${port}`));
