import { handleOption } from "@/lib/wants";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = async (req: Request, { params }: Ctx) => handleOption(req, (await params).id);
export const DELETE = async (req: Request, { params }: Ctx) => handleOption(req, (await params).id);
