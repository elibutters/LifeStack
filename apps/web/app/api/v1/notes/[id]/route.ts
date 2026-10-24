import { handleNoteOne } from "@/lib/notes";

export const dynamic = "force-dynamic";

export const GET = async (req: Request, { params }: { params: Promise<{ id: string }> }) => handleNoteOne(req, (await params).id);
