import { handleEmailOne } from "@/lib/email";

export const dynamic = "force-dynamic";

export const GET = async (req: Request, { params }: { params: Promise<{ id: string }> }) => handleEmailOne(req, (await params).id);
