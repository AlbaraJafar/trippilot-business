"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Textarea } from "./ui";
import { postJSON } from "./action-button";

export function ApprovalActions({ approvalId }: { approvalId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function decide(decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED") {
    setBusy(true);
    setErr(null);
    try {
      await postJSON(`/api/approvals/${approvalId}`, { decision, note });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Textarea rows={2} placeholder="Reason / note (required to reject or request changes)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="accent" disabled={busy} onClick={() => decide("APPROVED")}>Approve purchase</Button>
        <Button variant="secondary" disabled={busy} onClick={() => decide("CHANGES_REQUESTED")}>Request changes</Button>
        <Button variant="danger" disabled={busy} onClick={() => decide("REJECTED")}>Reject</Button>
      </div>
      <p className="text-[11px] text-muted">Approving authorises the purchase. Charging the payment method still requires separate, explicit payer consent.</p>
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}
