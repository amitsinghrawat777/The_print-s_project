# The Print's Project

Customers scan a QR code at a print shop, upload their files, choose pages, colour and copies,
see the price, and send the order. The shop owner gets it instantly in a desktop app, previews it
and prints it.

- Product plan: [`MVP_PLAN.md`](./MVP_PLAN.md) · long-term vision: [`PLAN.md`](./PLAN.md)
- System design: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## What works today

| Part | Status |
|---|---|
| **Customer web app** (`apps/web`) | ✅ QR link → upload (PDF, Word, PowerPoint, Excel, photos) → per-file pages / order / B&W, colour or mixed / copies / single or double sided → live price → send → token + live status page |
| **Public API** (`apps/web/app/api`) | ✅ Create order, signed direct-to-storage uploads, server-side price check, rate limits, per-order secret |
| **File processor** (`apps/processor`) | ✅ File-content checks, Word/PowerPoint/Excel → PDF (Gotenberg), photo → A4 PDF (fixes phone rotation), page counts, print-ready B&W/colour files, auto-retry of stuck work, auto-delete of old files |
| **Database** (`supabase/`) | ✅ Schema, row-level security, order tokens (A1, A2… reset daily), status rules, audit log |
| **Shop desktop app** (`apps/desktop`) | ⏳ Next milestone: owner login, live queue, in-app preview, print |

## Repository layout

```
apps/web          Next.js customer app + public API
apps/processor    Node service: convert, count pages, build print files, cleanup
packages/shared   Pricing, page ranges, validation schemas, status rules (used everywhere)
supabase/         Database migrations, row-level security, seed data
infra/            docker-compose for local Gotenberg
```

## Run it locally

Needs Node 22+, pnpm 10, and Docker.

```bash
pnpm install

# 1. Database, storage and auth (local Supabase in Docker)
pnpm db:start                 # first run downloads images; prints the local keys
#    If images fail to download from ghcr.io, run:
#    SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io pnpm db:start

# 2. Document conversion service
docker compose -f infra/docker-compose.yml up -d

# 3. Env files — paste SERVICE_ROLE_KEY from `pnpm supabase status`
cp apps/web/.env.example apps/web/.env.local
cp apps/processor/.env.example apps/processor/.env

# 4. Start the processor and the web app
pnpm --filter @print/shared build
pnpm --filter @print/processor dev     # http://localhost:8080
pnpm --filter @print/web dev           # http://localhost:3000
```

Open **http://localhost:3000/s/demo-xerox**. That's the demo shop from `supabase/seed.sql`
(₹2 B&W, ₹10 colour; owner login `owner@demo.test` / `demo-password`, local only).

To try it from a phone on the same Wi-Fi, use your computer's LAN IP instead of `127.0.0.1`
in `SUPABASE_URL` (the phone uploads straight to storage).

Optional: install Ghostscript (`gs`) so mixed colour + double-sided jobs print their B&W pages in
greyscale. Without it those pages print as they are.

## Hosted backend (Supabase)

| | |
|---|---|
| Project | `the-prints-project` (`jdawobuijasshdbkwwfr`), region `ap-south-1` (Mumbai) |
| API URL | `https://jdawobuijasshdbkwwfr.supabase.co` |
| Migrations | All four files in `supabase/migrations/` are applied |

The hosted project has no demo data. Create the first shop owner in the Supabase dashboard
(Authentication → Users), then add their shop and rates.
Put `SUPABASE_URL` and the **service role key** (Dashboard → Project Settings → API) only in
server-side env files (`apps/web/.env.local`, `apps/processor/.env`), never in browser or desktop code.

## Tests

```bash
pnpm test        # shared pricing/page ranges, processor, web helpers
pnpm typecheck
```

Processor tests that need extra tools skip themselves when the tool is missing:
Ghostscript (`gs`), and Gotenberg (set `GOTENBERG_URL=http://127.0.0.1:3001`).

## Key rules worth knowing

- **Prices** are calculated by one function (`packages/shared/src/pricing.ts`). The browser
  uses it for the live total, and the server runs it again on submit. If the two totals differ, the
  order is refused, and the customer sees the new total.
- **Double sided** is charged per sheet; a last page that ends up alone on a sheet is charged at
  the single-sided rate.
- **Files** are private and only reachable through short-lived links. Drafts expire after 2 hours,
  finished jobs 2 hours after *done*, and everything else after 24 hours. The processor then deletes
  the files.
