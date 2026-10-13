import { handleEmailSearch } from "@/lib/email";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleEmailSearch(req);
