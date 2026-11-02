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
| Shop onboarding website: landing page, download page, Google sign-in, setup wizard (shop, link, paper, prices), QR poster, owner dashboard | ✅ `apps/site` |

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

# 6. The shop onboarding website (optional, a fourth terminal)
cp apps/site/.env.example apps/site/.env.local
#   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: the "Publishable" key from `npx supabase status`
npm run dev:site          # http://localhost:3040
```

**Shop onboarding site.** New owners sign in with Google at <http://localhost:3040>, name their
shop, pick its link (`/s/<slug>`), paper sizes and prices, then print the QR poster and download the
desktop app. The shop and its prices are written with the owner's own session (row level security),
so the site needs only the publishable key. The desktop app's "No shop for this account yet" screen
links there. Installer buttons stay "Coming soon" until `NEXT_PUBLIC_DOWNLOAD_WINDOWS_URL` /
`NEXT_PUBLIC_DOWNLOAD_MAC_URL` are set. In production, add the site's `https://<domain>/**` to the
Supabase redirect URLs (Google comes back to `/auth/callback`).

Open <http://localhost:3030/s/demo-xerox> for the demo shop. Its owner login is
`owner@demo.test` / `demo-password`: sign in to the desktop app with it, send an order from the
customer page and it appears in the app with a sound. To try printing without a printer, start the
app with `PRINTS_PRINT_DRY_RUN=1`: print files are saved under the app's data folder instead.

**Shop login (Google).** Shop owners sign in to the desktop app with Google, so there are no
passwords to reset. The app opens the browser and Google sends the owner back to the app. To
turn it on locally:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth
   client of type **Web application** with the authorized redirect URI
   `http://127.0.0.1:54321/auth/v1/callback`.
2. Put it in `supabase/.env` (git-ignored):
   ```sh
   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=....apps.googleusercontent.com
   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=GOCSPX-...
   ```
3. Restart Supabase (`npm run db:stop && npm run db:start`; your data is kept).
4. Sign in once (the app says "No shop for this account yet"), then press **Set up your shop**: it
   opens the onboarding site (`npm run dev:site`), where the same Google account creates a shop.
   Press **Check again** in the app afterwards. Keep `demo-xerox` with `owner@demo.test`: the
   automated checks use it. Without the site, give your Google account a test shop with SQL:
   ```sh
   npx supabase db query --local "insert into shops (owner_id, name, slug, paper_sizes) select id, 'My Test Prints', 'my-test', '{A4}' from auth.users where email = 'you@gmail.com'"
   npx supabase db query --local "insert into shop_rates (shop_id, paper_size, color_mode, sides, price_paise) select (select id from shops where slug = 'my-test'), paper_size, color_mode, sides, price_paise from shop_rates where shop_id = (select id from shops where slug = 'demo-xerox')"
   ```

A Google login with the same email as an existing owner account is linked to it automatically, so
existing shops carry over. Development builds also show an email + password form
(`RENDERER_VITE_ALLOW_PASSWORD_LOGIN=1` in `apps/desktop/.env`) for the demo login and the
automated checks; builds for shops leave it out. In production: enable Google in the Supabase
dashboard with the hosted callback URL, add `http://127.0.0.1:*/auth/callback` to the redirect URLs,
publish the Google OAuth consent screen, and turn off email sign-in.

**Pausing orders.** A paused shop starts taking orders again by itself at 6:00 the next morning
(shop timezone), run by `pg_cron` every 5 minutes (`private.resume_paused_shops()`).

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
npm run site-check        # onboarding site as a new owner: sign in, create a shop, QR, dashboard
```

`smoke`, `ui-check` and `desktop-check` need everything from "Run it locally" running.
`site-check` needs Supabase and `dev:site` (and checks the new shop in `dev:web` if it's running).

**Website screenshots.** `npm run marketing-shots` retakes the product screenshots in
`apps/site/public/shots`. It creates a throwaway showcase shop with a day of realistic orders
(generated lab report, CV, assignment and photo), captures the customer's phone and the desktop
app, then deletes the shop, its files and its owner; `demo-xerox` is not touched. It needs
Supabase, the processor, the customer app (`WEB_URL`, default port 3030) and a desktop build
(`npm run build -w @prints/desktop`).

## Layout

```
apps/web/         Next.js 16: customer pages (/s/[slug], /j/[jobId]) and the public API (/api/...)
apps/processor/   Node service: file checks, conversion, page counts, print-ready PDFs, cleanup
apps/desktop/     Electron app for the shop owner: queue, preview, printing, rate card, settings
apps/site/        Next.js 16: shop onboarding website (landing, download, sign-in, setup wizard, dashboard)
packages/shared/  Pricing, page ranges, print plans, statuses, API schemas (used everywhere)
supabase/         Migrations, seed data, database tests, local config
infra/            docker-compose for Gotenberg (and the processor as a container)
scripts/          smoke-test.mjs, ui-check.mjs, desktop-check.mjs, site-check.mjs and their test files
```
