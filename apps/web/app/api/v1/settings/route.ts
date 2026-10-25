import { handleSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // changing the mail rules re-sorts stored mail

export const GET = (req: Request) => handleSettings(req);
export const PUT = (req: Request) => handleSettings(req);
export const DELETE = (req: Request) => handleSettings(req);
