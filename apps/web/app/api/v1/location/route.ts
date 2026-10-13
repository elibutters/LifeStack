import { handleLocation } from "@/lib/location";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleLocation(req);
export const POST = (req: Request) => handleLocation(req);
