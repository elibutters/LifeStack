import { handleGoal } from "@/lib/goals";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = async (req: Request, { params }: Ctx) => handleGoal(req, (await params).id);
