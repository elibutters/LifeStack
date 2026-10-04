import { handleGetProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleGetProfile(req);
