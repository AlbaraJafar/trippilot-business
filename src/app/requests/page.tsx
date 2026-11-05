import Link from "next/link";
import { Plus } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Card, Empty, PageHeader, StatusBadge, Td, Th } from "@/components/ui";

export default async function RequestsPage() {
  const user = await getCurrentUser();
  if (!user) return <Empty>Seed the database first.</Empty>;
  const requests = await prisma.travelRequest.findMany({
    where: {
      companyId: user.companyId,
      ...(user.role === "EMPLOYEE" ? { travelers: { some: { employeeId: user.employeeId ?? "-" } } } : {}),
    },
    include: { _count: { select: { travelers: true } }, department: true, itineraries: { select: { id: true, totalMinor: true } } },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="fade-up">
      <PageHeader
        title="Travel requests"
        subtitle={user.role === "EMPLOYEE" ? "Trips you are travelling on, with approval and booking status." : "Every request, its plan and where it sits in the approval → payment → booking flow."}
        actions={
          <Link href="/requests/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-navy-900 px-4 text-sm font-medium text-white hover:bg-navy-800">
            <Plus className="h-4 w-4" /> New request
          </Link>
        }
      />
      <Card className="overflow-x-auto">
        {requests.length === 0 ? (
          <Empty>No travel requests yet.</Empty>
        ) : (
          <table className="w-full min-w-[820px]">
            <thead>
              <tr><Th>Request</Th><Th>Route</Th><Th>Dates</Th><Th>Travelers</Th><Th>Department</Th><Th className="text-right">Plan total</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const sel = r.itineraries.find((i) => i.id === r.selectedItineraryId);
                return (
                  <tr key={r.id} className="hover:bg-canvas/60">
                    <Td>
                      <Link href={`/requests/${r.id}`} className="font-medium hover:underline">{r.title}</Link>
                      <div className="tabular text-[11px] text-muted">{r.code}</div>
                    </Td>
                    <Td>{r.origin} → {r.destination}</Td>
                    <Td className="tabular text-xs">{(JSON.parse(r.outboundDates) as string[])[0]}{(JSON.parse(r.returnDates) as string[])[0] ? ` – ${(JSON.parse(r.returnDates) as string[])[0]}` : ""}</Td>
                    <Td className="tabular">{r._count.travelers}</Td>
                    <Td className="text-xs">{r.department.name}</Td>
                    <Td className="tabular text-right">{sel ? formatMoney(sel.totalMinor) : "—"}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
