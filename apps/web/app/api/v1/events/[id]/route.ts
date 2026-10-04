import { handleDeleteEntry } from "@/lib/capture-api";

export const dynamic = "force-dynamic";

export const DELETE = async (req: Request, ctx: { params: Promise<{ id: string }> }) => handleDeleteEntry(req, (await ctx.params).id);
