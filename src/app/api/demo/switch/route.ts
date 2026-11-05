import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { DEMO_COOKIE } from "@/lib/auth";
import { handler } from "@/lib/api";

// DEMO AUTH ONLY: selects which seeded account is acting. Not a security boundary.
export const POST = handler(async (req: Request) => {
  const { userId } = z.object({ userId: z.string().min(1) }).parse(await req.json());
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "Unknown demo user" }, { status: 404 });
  const res = NextResponse.json({ ok: true, user: { id: user.id, name: user.name, role: user.role } });
  res.cookies.set(DEMO_COOKIE, user.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
});
