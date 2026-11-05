import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/shell";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { paypalConfig } from "@/lib/payments/paypal";
import { levelOf } from "@/lib/auth";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face" });

export const metadata: Metadata = {
  title: "TripPilot Business",
  description: "Your AI agent for smarter corporate travel and payments.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  const users = user ? await prisma.user.findMany({ where: { companyId: user.companyId }, orderBy: { createdAt: "asc" } }) : [];
  const unread = user ? await prisma.notification.count({ where: { companyId: user.companyId, read: false, OR: [{ userId: null }, { userId: user.id }] } }) : 0;
  const pendingApprovals = user ? await prisma.approval.count({ where: { status: "PENDING", level: { lte: Math.max(1, levelOf(user.role)) }, request: { companyId: user.companyId } } }) : 0;
  const cfg = paypalConfig();
  return (
    <html lang="en">
      <body className={`${inter.variable} ${mono.variable} font-sans`}>
        <Shell
          user={user && { id: user.id, name: user.name, role: user.role, title: user.title }}
          users={users.map((u) => ({ id: u.id, name: u.name, role: u.role, title: u.title }))}
          unread={unread}
          pendingApprovals={levelOf(user?.role ?? "") > 0 ? pendingApprovals : 0}
          sandbox={cfg.configured && cfg.isSandbox}
        >
          {children}
        </Shell>
      </body>
    </html>
  );
}
