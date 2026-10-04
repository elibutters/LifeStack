import { handleCalendar } from "@/lib/app-api";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleCalendar(req);
