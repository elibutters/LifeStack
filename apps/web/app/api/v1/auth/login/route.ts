import { handleLogin } from "@/lib/app-login";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => handleLogin(req);
