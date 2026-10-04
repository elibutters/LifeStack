import { handleEvents } from "@/lib/capture-api";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => handleEvents(req);
