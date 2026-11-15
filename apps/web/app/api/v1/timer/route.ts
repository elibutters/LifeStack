import { handleTimer } from "@/lib/timer";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleTimer(req);
export const POST = (req: Request) => handleTimer(req);
