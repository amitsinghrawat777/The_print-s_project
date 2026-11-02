# The Print's Project

Customers scan a QR code at a print shop's counter, upload their files, choose pages, colour and
copies, see the price and send the order. The shop gets it in a desktop app and prints it with
the customer's settings already filled in. No WhatsApp, no email, no pen drive.

- [`MVP_PLAN.md`](./MVP_PLAN.md): what the MVP does
- [`ARCHITECTURE.md`](./ARCHITECTURE.md): how it is built
- [`PLAN.md`](./PLAN.md): the long-term vision (online payment, automatic printing)

## What works today

| Part | Status |
|---|---|
| Database: shops, rates, orders, daily tokens, status rules, owner access rules, file storage | ✅ `supabase/` |
| File processor: checks files, converts Word/PowerPoint/Excel/images to PDF, counts pages, builds print-ready PDFs, deletes old files | ✅ `apps/processor` |
| Customer web app: upload, page thumbnails, page ranges and order, B&W/colour/mixed, copies, sides, paper, live price, review, token and status page | ✅ `apps/web` |
| Shop owner desktop app: login, live queue with sound and notifications, in-app preview, printing with the order's settings, Paid/Done, rate card, shop settings, QR poster | ✅ `apps/desktop` (Windows tested; installers and auto-update come in week 4) |

## Run it locally

You need **Node 22+** and **Docker Desktop**.

```sh
npm install

# 1. Database, storage, auth and realtime (Supabase in Docker)
npm run db:start          # first run downloads the images; prints the local keys
npm run db:reset          # applies supabase/migrations and supabase/seed.sql

# 2. Office-to-PDF converter
npm run services:up       # Gotenberg on http://127.0.0.1:3100

# 3. Environment files
cp apps/processor/.env.example apps/processor/.env
cp apps/web/.env.example apps/web/.env.local
#   SUPABASE_SECRET_KEY: the "Secret" key from `npx supabase status`
#   PROCESSOR_SECRET: any long random string, the same in both files

# 4. The two apps (two terminals)
npm run dev:processor     # http://127.0.0.1:4000
npm run dev:web           # http://localhost:3030

# 5. The shop owner desktop app (a third terminal)
cp apps/desktop/.env.example apps/desktop/.env
#   RENDERER_VITE_SUPABASE_PUBLISHABLE_KEY: the "Publishable" key from `npx supabase status`
npm run fetch-sumatra -w @prints/desktop   # Windows only: the print engine (checksum-verified)
npm run dev:desktop
```

Open <http://localhost:3030/s/demo-xerox> for the demo shop. Its owner login is
`owner@demo.test` / `demo-password`: sign in to the desktop app with it, send an order from the
customer page and it appears in the app with a sound. To try printing without a printer, start the
app with `PRINTS_PRINT_DRY_RUN=1`: print files are saved under the app's data folder instead.

**Try it on your phone** (same Wi-Fi as your PC): in `apps/web/.env.local` set
`ALLOWED_DEV_ORIGINS=192.168.x.x` and `SUPABASE_URL=http://192.168.x.x:54321` (your PC's IP, so
the upload links work from the phone), restart `dev:web` and open
`http://192.168.x.x:3030/s/demo-xerox`. If the phone can't connect, allow ports 3030 and 54321
in Windows Firewall.

## Checks

```sh
npm test                  # unit tests: pricing, page ranges, print plans, file handling
npm run typecheck
npx supabase test db      # database tests: tokens, status rules, owner access (pgTAP)
npm run smoke             # end to end through the API, as customer and shop owner
npm run ui-check          # clicks through the customer screens in Chrome, saves screenshots/
npm run desktop-check     # drives the desktop app: login, live order, preview, print (dry run), done
```

`smoke`, `ui-check` and `desktop-check` need everything from "Run it locally" running.

## Layout

```
apps/web/         Next.js 16: customer pages (/s/[slug], /j/[jobId]) and the public API (/api/...)
apps/processor/   Node service: file checks, conversion, page counts, print-ready PDFs, cleanup
apps/desktop/     Electron app for the shop owner: queue, preview, printing, rate card, settings
packages/shared/  Pricing, page ranges, print plans, statuses, API schemas (used everywhere)
supabase/         Migrations, seed data, database tests, local config
infra/            docker-compose for Gotenberg (and the processor as a container)
scripts/          smoke-test.mjs, ui-check.mjs and their test files
```
