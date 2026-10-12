import { handleWants } from "@/lib/wants";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleWants(req);
export const POST = (req: Request) => handleWants(req);
