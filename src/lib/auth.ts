import "server-only";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { ROLE_LEVEL, type Role } from "./domain/types";

/**
 * DEMO AUTHENTICATION — a cookie holding a seeded user id, chosen from the account
 * switcher. There are no passwords. Replace with real SSO (e.g. Auth.js + OIDC)
 * before any production use. Role checks below are enforced server-side regardless.
 */
export const DEMO_COOKIE = "tp_demo_user";

export async function getCurrentUser() {
  const jar = await cookies();
  const id = jar.get(DEMO_COOKIE)?.value;
  const user = id ? await prisma.user.findUnique({ where: { id } }) : null;
  if (user) return user;
  // default demo identity: the travel manager
  return prisma.user.findFirst({ where: { role: "TRAVEL_MANAGER" }, orderBy: { createdAt: "asc" } });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser(roles?: Role[]) {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "No demo user found — run `npm run db:reset` to seed the database.");
  if (roles && !roles.includes(user.role as Role)) throw new HttpError(403, `This action requires one of: ${roles.join(", ")}.`);
  return user;
}

export function levelOf(role: string): number {
  return ROLE_LEVEL[role as Role] ?? 0;
}
