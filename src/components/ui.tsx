import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ComponentProps, ReactNode } from "react";

/** Small shadcn-style primitive set (hand-written, no CLI) tuned for a restrained B2B look. */

export function cn(...c: (string | false | null | undefined)[]) {
  return twMerge(clsx(c));
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
const variants: Record<Variant, string> = {
  primary: "bg-navy-900 text-white hover:bg-navy-800 disabled:bg-navy-600/50",
  accent: "bg-accent text-white hover:bg-[#0c8a5d] disabled:opacity-50",
  secondary: "bg-white text-ink border border-line hover:bg-canvas disabled:opacity-50",
  ghost: "text-ink hover:bg-canvas",
  danger: "bg-white text-danger border border-danger/30 hover:bg-danger-soft disabled:opacity-50",
};

export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
        variants[variant],
        className,
      )}
      {...p}
    />
  );
}

export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div className={cn("rounded-lg border border-line bg-white", className)} {...p} />;
}

export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-line px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const tones = {
  neutral: "bg-canvas text-muted border-line",
  green: "bg-accent-soft text-accent border-accent/20",
  amber: "bg-warn-soft text-warn border-warn/20",
  red: "bg-danger-soft text-danger border-danger/20",
  navy: "bg-navy-900 text-white border-navy-900",
  blue: "bg-[#eef3ff] text-[#2c4fb3] border-[#2c4fb3]/15",
} as const;

export function Badge({ tone = "neutral", className, children }: { tone?: keyof typeof tones; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4", tones[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, keyof typeof tones> = {
  COMPLIANT: "green", REQUIRES_APPROVAL: "amber", POLICY_VIOLATION: "red",
  DRAFT: "neutral", SEARCHED: "blue", PLANNED: "blue", PENDING_APPROVAL: "amber", CHANGES_REQUESTED: "amber",
  REJECTED: "red", APPROVED: "green", PAYMENT_PENDING: "amber", PAID: "green", BOOKED: "navy", REFUNDED: "neutral", CANCELLED: "neutral",
  PENDING: "amber", SUPERSEDED: "neutral",
  CREATED: "neutral", PAYER_ACTION_REQUIRED: "amber", CAPTURING: "amber", CAPTURED: "green", CAPTURE_PENDING: "amber", FAILED: "red",
  NOT_STARTED: "neutral", SIMULATED_HELD: "amber", SIMULATED_CONFIRMED: "blue", ACTIVE: "blue", TRIGGERED: "green",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label ?? status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}

export function DemoBadge({ label = "Demo inventory" }: { label?: string }) {
  return (
    <Badge tone="amber" className="uppercase tracking-wide">
      {label}
    </Badge>
  );
}

export function Label({ className, ...p }: ComponentProps<"label">) {
  return <label className={cn("mb-1 block text-xs font-medium text-muted", className)} {...p} />;
}

const field = "h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-600/10";
export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={cn(field, className)} {...p} />;
}
export function Select({ className, ...p }: ComponentProps<"select">) {
  return <select className={cn(field, "pr-8", className)} {...p} />;
}
export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea className={cn(field, "h-auto min-h-20 py-2", className)} {...p} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Th({ className, ...p }: ComponentProps<"th">) {
  return <th className={cn("border-b border-line bg-canvas/60 px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted", className)} {...p} />;
}
export function Td({ className, ...p }: ComponentProps<"td">) {
  return <td className={cn("border-b border-line px-4 py-2.5 align-top text-sm", className)} {...p} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-muted">{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}
