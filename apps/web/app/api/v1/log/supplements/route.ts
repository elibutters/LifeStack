import { handleSupplements } from "@/lib/capture-api";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleSupplements(req);
