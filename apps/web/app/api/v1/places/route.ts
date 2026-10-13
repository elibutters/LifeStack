import { handlePlaces } from "@/lib/location";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handlePlaces(req);
export const POST = (req: Request) => handlePlaces(req);
