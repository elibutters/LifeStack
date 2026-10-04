import { handleAmazonSnapshot } from "@/lib/amazon-api";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => handleAmazonSnapshot(req);
