import { handleSleep } from "@/lib/app-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = (req: Request) => handleSleep(req);
