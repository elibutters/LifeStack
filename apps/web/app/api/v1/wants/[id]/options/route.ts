import { handleAddOption } from "@/lib/wants";

export const dynamic = "force-dynamic";

export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }) => handleAddOption(req, (await params).id);
