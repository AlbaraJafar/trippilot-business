import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { paypalConfig } from "@/lib/payments/paypal";
import { claudeConfigured, claudeModel } from "@/lib/ai/claude";
import { getFlightProvider } from "@/lib/providers";
import { FX_DESCRIPTION } from "@/lib/money";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, CardHeader, Empty, PageHeader } from "@/components/ui";

function Row({ label, ok, children }: { label: string; ok: boolean | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-4 px-5 py-3 text-sm">
      <div className="w-48 shrink-0 font-medium">{label}</div>
      <div className="w-24 shrink-0">{ok === null ? <Badge>Info</Badge> : ok ? <Badge tone="green">Active</Badge> : <Badge tone="amber">Not configured</Badge>}</div>
      <div className="min-w-0 flex-1 text-muted">{children}</div>
    </div>
  );
}

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) return <Empty>Seed the database first.</Empty>;
  const pp = paypalConfig();
  const provider = getFlightProvider();
  const users = await prisma.user.findMany({ where: { companyId: user.companyId }, orderBy: { createdAt: "asc" } });
  return (
    <div className="fade-up">
      <PageHeader title="Settings" subtitle="Integration status and demo controls. Secrets live only in server environment variables." />
      <Card>
        <CardHeader title="Integrations" />
        <div className="divide-y divide-line">
          <Row label="PayPal" ok={pp.configured}>
            {pp.configured ? `Orders v2 via ${pp.baseUrl} (${pp.isSandbox ? "Sandbox" : "LIVE"}). ` : "Set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET. "}
            Charge currency: <b>{pp.chargeCurrency}</b>{pp.currencySupported ? "" : " (unsupported!)"}. SAR is not a PayPal REST currency; amounts convert at {FX_DESCRIPTION}.
            {" "}Webhook verification: {pp.webhookId ? "enabled" : "set PAYPAL_WEBHOOK_ID to enable"}.
          </Row>
          <Row label="Flight provider" ok={provider.isLive}>
            {provider.label}. Capabilities: search {provider.capabilities.search ? "✓" : "✗"}, booking {provider.capabilities.booking ? "✓" : "✗ (simulated)"}, ticketing{" "}
            {provider.capabilities.ticketing ? "✓" : "✗"}. Set FLIGHT_PROVIDER=DUFFEL with DUFFEL_ACCESS_TOKEN for live search.
          </Row>
          <Row label="Anthropic Claude" ok={claudeConfigured()}>
            {claudeConfigured() ? `Model ${claudeModel()} for instruction parsing & explanations (validated).` : "Not configured — deterministic parser and explanations are used. Set ANTHROPIC_API_KEY."}
          </Row>
          <Row label="Authentication" ok={null}>
            Demo account selector (cookie). No passwords. Replace with SSO before production use. Role checks are enforced server-side.
          </Row>
        </div>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Demo accounts" />
        <ul className="divide-y divide-line text-sm">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap gap-4 px-5 py-2.5">
              <span className="w-44 font-medium">{u.name}</span>
              <span className="w-40"><Badge tone={u.role === "ADMIN" ? "navy" : "neutral"}>{u.role.replace("_", " ").toLowerCase()}</Badge></span>
              <span className="text-muted">{u.title}</span>
            </li>
          ))}
        </ul>
      </Card>
      {user.role === "ADMIN" && (
        <Card className="mt-4">
          <CardHeader title="Reset demo data" subtitle="Re-runs the deterministic seed. Deletes all requests, payments records and plans in the local database (not in PayPal)." />
          <div className="p-5">
            <ActionButton url="/api/demo/reset" variant="danger" confirm="Reset all demo data to the seeded state?">Reset demo database</ActionButton>
          </div>
        </Card>
      )}
    </div>
  );
}
