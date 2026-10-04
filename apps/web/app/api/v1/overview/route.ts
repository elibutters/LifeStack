import { handleOverview } from "@/lib/app-api";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleOverview(req);
