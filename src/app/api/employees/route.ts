import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { createEmployee } from "@/lib/services/employees";

export const POST = handler(async (req: Request) => {
  const user = await requireUser(["ADMIN"]);
  const e = await createEmployee(user, await req.json());
  return NextResponse.json({ id: e.id });
});
