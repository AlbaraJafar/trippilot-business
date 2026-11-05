import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";

// Re-runs the deterministic seed so the demo is repeatable. Admin only; disabled in production.
export const POST = handler(async () => {
  await requireUser(["ADMIN"]);
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Disabled in production" }, { status: 403 });
  const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  await promisify(execFile)(process.execPath, [cli, "prisma/seed.ts"], { cwd: process.cwd(), timeout: 60000 });
  return NextResponse.json({ ok: true });
});
