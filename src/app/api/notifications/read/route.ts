import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { prisma } from "@/lib/db";

export const POST = handler(async () => {
  const user = await requireUser();
  await prisma.notification.updateMany({ where: { companyId: user.companyId, OR: [{ userId: null }, { userId: user.id }] }, data: { read: true } });
  return NextResponse.json({ ok: true });
});
