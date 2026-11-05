"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, Bell, Bot, CheckSquare, CreditCard, LayoutDashboard, Menu, Plane, Scale, Settings, Users, X,
} from "lucide-react";
import { cn } from "./ui";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/requests", label: "Travel Requests", icon: Plane },
  { href: "/employees", label: "Employees", icon: Users },
  { href: "/agent", label: "AI Travel Agent", icon: Bot },
  { href: "/approvals", label: "Approvals", icon: CheckSquare },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/policies", label: "Policies", icon: Scale },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface DemoUser { id: string; name: string; role: string; title: string }

export function Shell({
  children, user, users, unread, pendingApprovals, sandbox,
}: {
  children: React.ReactNode;
  user: DemoUser | null;
  users: DemoUser[];
  unread: number;
  pendingApprovals: number;
  sandbox: boolean;
}) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function switchUser(id: string) {
    await fetch("/api/demo/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: id }) });
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-col gap-0.5 px-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
              active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.8} />
            <span className="flex-1">{label}</span>
            {href === "/approvals" && pendingApprovals > 0 && (
              <span className="rounded bg-accent px-1.5 text-[10px] font-semibold text-white">{pendingApprovals}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent">
        <Plane className="h-4 w-4 -rotate-45 text-white" strokeWidth={2.2} />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-white">TripPilot</div>
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/50">Business</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-navy-950 lg:flex">
        {brand}
        {nav}
        <div className="mt-auto space-y-2 px-5 py-5 text-[11px] leading-relaxed text-white/45">
          <div>Flights: <span className="text-amber-300">demo inventory</span></div>
          <div>Payments: {sandbox ? <span className="text-emerald-300">PayPal Sandbox</span> : <span className="text-white/70">PayPal not configured</span>}</div>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-navy-950/50" />
          <aside className="absolute inset-y-0 left-0 w-64 bg-navy-950" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button aria-label="Close menu" onClick={() => setOpen(false)} className="text-white/70"><X className="h-5 w-5" /></button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur lg:px-8">
        <button aria-label="Open menu" className="lg:hidden" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
        <div className="hidden text-xs text-muted sm:block">Northstar Consulting</div>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/notifications" className="relative rounded-md p-2 text-muted hover:bg-canvas" aria-label="Notifications">
            <Bell className="h-4 w-4" />
            {unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent" />}
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden rounded border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn sm:inline">Demo login</span>
            <select
              aria-label="Switch demo account"
              value={user?.id ?? ""}
              onChange={(e) => switchUser(e.target.value)}
              className="h-8 max-w-[220px] rounded-md border border-line bg-white px-2 text-xs"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
