import { handlePulse } from "@/lib/pulse";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handlePulse(req);
