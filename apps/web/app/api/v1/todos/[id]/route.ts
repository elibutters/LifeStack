import { handleTodo } from "@/lib/todos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = async (req: Request, { params }: Ctx) => handleTodo(req, (await params).id);
export const DELETE = async (req: Request, { params }: Ctx) => handleTodo(req, (await params).id);
