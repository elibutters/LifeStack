import { handleSessionAction } from "@/lib/goals";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // updating the calendar can take a moment

export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }) => handleSessionAction(req, (await params).id);
