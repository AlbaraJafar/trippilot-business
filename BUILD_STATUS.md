# BUILD_STATUS

_Last updated: 2026-11-05_

## Commands

```bash
npm install && npm run setup   # install, create DB, seed
npm run dev                    # http://localhost:3000
npm test                       # 18 unit tests (vitest)
npm run typecheck              # tsc --noEmit
npx eslint src prisma tests    # lint
npm run build                  # production build
node scripts/smoke.mjs         # 15-step API smoke test (needs dev server running)
npm run db:reset               # back to the seeded demo state
```

## Completed

- [x] Next.js 15 + TypeScript + Tailwind v4 foundation, navigation shell, demo account switcher
- [x] Prisma schema (17 models, integer money) + deterministic Northstar Consulting seed
- [x] Dashboard with DB-derived KPIs and 5 charts
- [x] Employee directory: add / edit / deactivate, CSV import with validation
- [x] Travel request wizard (individual/group, multi-date, all constraints)
- [x] FlightProvider interface; Demo provider; Duffel search adapter
- [x] Optimizer: hard constraints, weighted scoring, capacity-aware group plans, unsatisfiable travelers, budget exceptions, baseline savings
- [x] Policy engine + approval routing (TM → dept head → executive, dept-budget escalation)
- [x] AI: Claude tool-use extraction with Zod validation + deterministic parser fallback; grounded explanations
- [x] AI agent console → request → auto search + optimize
- [x] Approval inbox (approve / reject / request changes, reasons, history)
- [x] PayPal Orders v2: create (idempotent, duplicate-reuse), return-URL capture with lock + verification, cancel, sync, refund, verified webhook receiver
- [x] Transaction ledger with filters + detail page with event history
- [x] Booking lifecycle independent of payment (simulated holds → confirmed)
- [x] Price monitoring with simulated fare drift + notifications
- [x] Audit log + notifications
- [x] README, .env.example, MIT license

## Verified

- Unit tests: 18/18 pass (optimizer constraints and capacity, plans, approval routing, money/FX, NL parser, explanation grounding, PayPal request shape, error mapping, capture verification).
- API smoke test: 15/15 pass (parse → create → RBAC → optimize → route to dept head → payment blocked pre-approval → TM cannot approve level 2 → dept head approves → double-approve 409 → preview → tampered amount 409 → no fake success without PayPal).
- `tsc`, ESLint and `next build` are clean.
- Browser walkthrough: dashboard, agent flow with auto-optimize, plan selection, approval switch, checkout panel.

## Not yet verified / requires credentials

- **Live PayPal Sandbox round trip** (order → buyer approval → capture → refund) has **not** been executed in this environment because no Sandbox credentials were configured. The client is unit-tested against PayPal's documented request/response shapes. Add `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` and run `node scripts/smoke.mjs`, then approve the printed URL.
- Webhook verification needs a public URL + `PAYPAL_WEBHOOK_ID`.
- Claude path needs `ANTHROPIC_API_KEY` (deterministic fallback verified).
- Duffel adapter needs `DUFFEL_ACCESS_TOKEN` (not exercised).

## Known issues

- Running `next build` while `next dev` is running can corrupt dev manifests. Restart dev afterwards.
- Phase 7 items (hosted demo, public repo, video, screenshots) are not done.
