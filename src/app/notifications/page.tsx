import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) return <Empty>Seed the database first.</Empty>;
  const items = await prisma.notification.findMany({
    where: { companyId: user.companyId, OR: [{ userId: null }, { userId: user.id }] },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return (
    <div className="fade-up">
      <PageHeader title="Notifications" actions={<ActionButton url="/api/notifications/read" variant="secondary" size="sm">Mark all read</ActionButton>} />
      <Card>
        {items.length === 0 ? <Empty>No notifications.</Empty> : (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-line" : "bg-accent"}`} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</div>
                  <div className="text-xs text-muted">{n.body}</div>
                </div>
                <Badge>{n.kind.toLowerCase()}</Badge>
                <span className="tabular shrink-0 text-xs text-muted">{n.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" })}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
