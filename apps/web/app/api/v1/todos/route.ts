import { handleTodos } from "@/lib/todos";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handleTodos(req);
export const POST = (req: Request) => handleTodos(req);
