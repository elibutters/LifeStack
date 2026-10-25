import { handleTonight } from "@/lib/goals";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleTonight(req);
