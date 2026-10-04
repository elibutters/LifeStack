import { handleConnections } from "@/lib/app-api";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleConnections(req);
