import { handleHistory } from "@/lib/capture-api";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleHistory(req);
