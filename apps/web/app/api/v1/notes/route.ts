import { handleNotesSearch } from "@/lib/notes";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleNotesSearch(req);
