import { handleBrief } from "@/lib/brief";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleBrief(req);
export const POST = (req: Request) => handleBrief(req);
