// End-to-end API smoke test against a running server (npm run dev).
// Usage: node scripts/smoke.mjs [baseUrl]
// Drives: NL parse → create request → optimize → select → role checks → approve → checkout.
// Checkout succeeds (returns a PayPal approval URL) only when Sandbox credentials are configured;
// otherwise it must fail with 503 — never with a fake success.
import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] ?? "http://localhost:3000";
const prisma = new PrismaClient();
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
};

async function as(email) {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return `tp_demo_user=${u.id}`;
}
async function call(cookie, path, body, method = body === undefined ? "GET" : "POST") {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

const tm = await as("travel@northstar.example");
const head = await as("faisal@northstar.example");
const emp = await as("noura@northstar.example");

const parsed = await call(tm, "/api/agent/parse", {
  text: "Arrange a trip for 10 employees from Riyadh to Jeddah on March 15. They need to arrive before 10 AM and return after 5 PM on March 16. Do not exceed SAR 1,200 per employee. Keep the total below SAR 15,000. Direct flights only.",
});
ok(parsed.status === 200 && parsed.json.requirements.travelerCount === 10, `NL parse (${parsed.json.engine})`);
ok(parsed.json.requirements.maxPerEmployeeSar === 1200, "per-employee cap extracted");

const dept = await prisma.department.findFirstOrThrow({ where: { code: "CONS" } });
const created = await call(tm, "/api/requests", {
  requirements: parsed.json.requirements,
  employeeIds: parsed.json.suggestedEmployeeIds,
  departmentId: dept.id,
  parsedBy: parsed.json.engine,
});
ok(created.status === 200, `request created ${created.json.code}`);
const id = created.json.id;

const badEmp = await call(emp, `/api/requests/${id}/optimize`, {});
ok(badEmp.status === 403, "employee cannot run optimization (403)");

const opt = await call(tm, `/api/requests/${id}/optimize`, {});
ok(opt.status === 200 && opt.json.plans.length === 3, `3 plans generated, recommended=${opt.json.recommended}`);

const its = await prisma.itinerary.findMany({ where: { requestId: id }, include: { assignments: true } });
const rec = its.find((i) => i.strategy === opt.json.recommended);
ok(rec && rec.feasible && rec.totalMinor <= 1500000, `recommended plan feasible, total SAR ${rec.totalMinor / 100}`);

const sel = await call(tm, `/api/requests/${id}/select`, { itineraryId: rec.id });
ok(sel.status === 200 && sel.json.level === 2, `approval routed to level ${sel.json.level} (department head)`);

const earlyPay = await call(tm, `/api/requests/${id}/checkout`, { accepted: true, amountMinor: rec.totalMinor });
ok(earlyPay.status === 409, `payment blocked before approval (${earlyPay.status})`);

const ap = await prisma.approval.findFirstOrThrow({ where: { requestId: id, status: "PENDING" } });
const tmApprove = await call(tm, `/api/approvals/${ap.id}`, { decision: "APPROVED", note: "" });
ok(tmApprove.status === 403, "travel manager cannot approve a department-head approval (403)");
const approve = await call(head, `/api/approvals/${ap.id}`, { decision: "APPROVED", note: "OK for client workshop" });
ok(approve.status === 200, "department head approved");
const again = await call(head, `/api/approvals/${ap.id}`, { decision: "APPROVED", note: "" });
ok(again.status === 409, "double approval rejected (409)");

const preview = await call(tm, `/api/requests/${id}/checkout`);
ok(preview.status === 200 && preview.json.amountMinor === rec.totalMinor, `checkout preview SAR ${preview.json.amountMinor / 100} → ${preview.json.chargeCurrency} ${preview.json.chargeAmountMinor / 100}`);
const lineSum = preview.json.lines.reduce((a, l) => a + l.chargeMinor, 0);
ok(lineSum === preview.json.chargeAmountMinor, "charge total equals sum of converted lines");

const tamper = await call(tm, `/api/requests/${id}/checkout`, { accepted: true, amountMinor: rec.totalMinor - 100 });
ok(tamper.status === 409, `tampered amount refused (${tamper.status})`);

const pay = await call(tm, `/api/requests/${id}/checkout`, { accepted: true, amountMinor: rec.totalMinor });
if (preview.json.paypalConfigured) {
  ok(pay.status === 200 && /paypal\.com/.test(pay.json.approveUrl), `PayPal Sandbox order created → ${pay.json.approveUrl}`);
  const dup = await call(tm, `/api/requests/${id}/checkout`, { accepted: true, amountMinor: rec.totalMinor });
  ok(dup.status === 200 && dup.json.reused === true && dup.json.paymentId === pay.json.paymentId, "duplicate checkout reuses the open order");
  console.log(`\nApprove the order in a browser, then the /checkout/return page captures it:\n  ${pay.json.approveUrl}`);
} else {
  ok(pay.status === 503, "PayPal not configured → 503 (no fake success)");
}

await prisma.$disconnect();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
