"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Button } from "./ui";

export async function postJSON<T = unknown>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issues = Array.isArray(json.issues) ? ` — ${json.issues.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join("; ")}` : "";
    throw new Error((json.error ?? `Request failed (${res.status})`) + issues);
  }
  return json as T;
}

/** A button that POSTs to an API route, shows pending + error state, then refreshes server data. */
export function ActionButton({
  url,
  body,
  children,
  variant = "primary",
  size = "md",
  confirm,
  onDone,
  disabled,
  className,
}: {
  url: string;
  body?: unknown;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  size?: "sm" | "md";
  confirm?: string;
  onDone?: (result: unknown) => void;
  disabled?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={disabled || pending || busy}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setError(null);
          setBusy(true);
          try {
            const r = await postJSON(url, body);
            onDone?.(r);
            start(() => router.refresh());
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy || pending ? "Working…" : children}
      </Button>
      {error && <span className="max-w-md text-xs text-danger">{error}</span>}
    </span>
  );
}
