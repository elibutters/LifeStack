import { handleSetDose } from "@/lib/capture-api";

export const dynamic = "force-dynamic";

export const PUT = async (req: Request, ctx: { params: Promise<{ id: string }> }) => handleSetDose(req, (await ctx.params).id);
