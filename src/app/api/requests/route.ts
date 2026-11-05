import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { createTravelRequest } from "@/lib/services/requests";

export const POST = handler(async (req: Request) => {
  const user = await requireUser(["TRAVEL_MANAGER", "ADMIN", "EMPLOYEE"]);
  const body = await req.json();
  if (user.role === "EMPLOYEE") {
    // employees may only request travel for themselves
    if (!user.employeeId || body?.employeeIds?.length !== 1 || body.employeeIds[0] !== user.employeeId)
      return NextResponse.json({ error: "Employees can only submit requests for themselves." }, { status: 403 });
  }
  const r = await createTravelRequest(user, body);
  return NextResponse.json({ id: r.id, code: r.code });
});
