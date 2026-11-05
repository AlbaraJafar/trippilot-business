import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./auth";
import { prisma } from "./db";

/** Wrap a route handler: consistent JSON errors, no stack traces or secrets leaked. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError)
        return NextResponse.json(
          { error: "Validation failed", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
          { status: 400 },
        );
      console.error("[api] unexpected error", e);
      return NextResponse.json({ error: "Unexpected server error. Check server logs." }, { status: 500 });
    }
  };
}

export async function audit(
  companyId: string,
  actor: { id: string; name: string } | null,
  action: string,
  entity: string,
  entityId: string,
  details?: Record<string, unknown>,
) {
  await prisma.auditLog.create({
    data: {
      companyId,
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? "TripPilot Agent",
      action,
      entity,
      entityId,
      details: details ? JSON.stringify(details) : null,
    },
  });
}

export async function notify(companyId: string, n: { userId?: string | null; kind: string; title: string; body: string; link?: string }) {
  await prisma.notification.create({ data: { companyId, userId: n.userId ?? null, kind: n.kind, title: n.title, body: n.body, link: n.link } });
}
