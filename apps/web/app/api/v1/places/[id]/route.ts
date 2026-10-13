import { handlePlace } from "@/lib/location";

export const dynamic = "force-dynamic";

export const DELETE = async (req: Request, { params }: { params: Promise<{ id: string }> }) => handlePlace(req, (await params).id);
