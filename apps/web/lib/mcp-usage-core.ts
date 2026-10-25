// Pure: turns recorded MCP calls into the numbers the usage page shows. No database here.
export type Call = {
  at: Date;
  tool: string;
  tokenId: number | null;
  ms: number;
  outcome: "ok" | "tool_error" | "invalid" | "unknown_tool";
  bytes: number;
  argKeys: string[];
  error?: string;
};

export type ToolStats = { tool: string; calls: number; errors: number; errorRate: number; avgMs: number; p95Ms: number; maxBytes: number; lastAt: Date };

const pct = (sorted: number[], p: number) => (sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0) : 0);

export function toolStats(calls: Call[]): ToolStats[] {
  const by = new Map<string, Call[]>();
  for (const c of calls) by.set(c.tool, [...(by.get(c.tool) ?? []), c]);
  return [...by.entries()]
    .map(([tool, list]) => {
      const ms = list.map((c) => c.ms).sort((a, b) => a - b);
      const errors = list.filter((c) => c.outcome !== "ok").length;
      return {
        tool, calls: list.length, errors, errorRate: errors / list.length,
        avgMs: Math.round(ms.reduce((n, v) => n + v, 0) / ms.length), p95Ms: Math.round(pct(ms, 0.95)),
        maxBytes: Math.max(...list.map((c) => c.bytes)), lastAt: new Date(Math.max(...list.map((c) => c.at.getTime()))),
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

// Failures grouped by tool and message, most common first: the fastest way to see what Claude keeps getting wrong.
export function commonErrors(calls: Call[], limit = 10): { tool: string; outcome: Call["outcome"]; error: string; count: number; argKeys: string[] }[] {
  const by = new Map<string, { tool: string; outcome: Call["outcome"]; error: string; count: number; argKeys: string[] }>();
  for (const c of calls) {
    if (c.outcome === "ok") continue;
    const k = `${c.tool}|${c.outcome}|${c.error ?? ""}`;
    const cur = by.get(k);
    if (cur) cur.count++;
    else by.set(k, { tool: c.tool, outcome: c.outcome, error: c.error ?? "", count: 1, argKeys: c.argKeys });
  }
  return [...by.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

// The same tool called again by the same key within `windowMs`: the first answer was probably not enough.
export function repeats(calls: Call[], windowMs = 5 * 60_000): { tool: string; count: number }[] {
  const sorted = [...calls].sort((a, b) => a.at.getTime() - b.at.getTime());
  const last = new Map<string, number>();
  const out = new Map<string, number>();
  for (const c of sorted) {
    const k = `${c.tokenId}|${c.tool}`;
    const prev = last.get(k);
    if (prev != null && c.at.getTime() - prev <= windowMs) out.set(c.tool, (out.get(c.tool) ?? 0) + 1);
    last.set(k, c.at.getTime());
  }
  return [...out.entries()].map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count);
}

// Pairs of different tools called back to back by one key: candidates to merge into a single tool.
export function sequences(calls: Call[], windowMs = 10 * 60_000, limit = 8): { from: string; to: string; count: number }[] {
  const sorted = [...calls].sort((a, b) => a.at.getTime() - b.at.getTime());
  const prev = new Map<number | null, Call>();
  const out = new Map<string, { from: string; to: string; count: number }>();
  for (const c of sorted) {
    const p = prev.get(c.tokenId);
    if (p && p.tool !== c.tool && c.at.getTime() - p.at.getTime() <= windowMs) {
      const k = `${p.tool}|${c.tool}`;
      out.set(k, { from: p.tool, to: c.tool, count: (out.get(k)?.count ?? 0) + 1 });
    }
    prev.set(c.tokenId, c);
  }
  return [...out.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export const unused = (offered: string[], calls: Call[]) => offered.filter((t) => !calls.some((c) => c.tool === t)).sort();

// Reads one JSON-RPC response (single or batch) for the outcome of a tools/call.
export function outcomeOf(res: unknown): { outcome: Call["outcome"]; bytes: number; error?: string } {
  const r = (Array.isArray(res) ? res[0] : res) as { error?: { message?: string }; result?: { isError?: boolean; content?: { text?: string }[] } } | undefined;
  if (!r) return { outcome: "unknown_tool", bytes: 0 };
  if (r.error) return { outcome: "invalid", bytes: 0, error: clean(r.error.message ?? "") };
  const text = r.result?.content?.map((c) => c.text ?? "").join("") ?? "";
  // A tool the SDK validated but that failed comes back as a result with isError; an unknown tool comes back the same way.
  if (r.result?.isError) return { outcome: /not found/i.test(text) ? "unknown_tool" : /input validation|invalid arguments/i.test(text) ? "invalid" : "tool_error", bytes: text.length, error: clean(text) };
  return { outcome: "ok", bytes: text.length };
}

// Messages are kept short and carry no values: type words only.
const clean = (m: string) => m.replace(/\s+/g, " ").slice(0, 200);
