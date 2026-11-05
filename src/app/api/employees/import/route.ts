import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { importEmployeesCsv } from "@/lib/services/employees";

export const POST = handler(async (req: Request) => {
  const user = await requireUser(["ADMIN"]);
  const { csv, commit } = z.object({ csv: z.string().min(1).max(500_000), commit: z.boolean().default(false) }).parse(await req.json());
  return NextResponse.json(await importEmployeesCsv(user, csv, commit));
});
