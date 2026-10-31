# The Print's Project — MVP Plan

> **MVP promise:** the customer scans the QR and uploads. The file shows up instantly in the
> shop's desktop app. The owner previews it and prints it with one click. No WhatsApp,
> no email, no pen drive, no downloads folder.

This MVP is deliberately smaller than the full vision in [`PLAN.md`](./PLAN.md).
**Payments, automatic printing and split settlements are left out.** They become Phase 2
once shops are using this every day.

---

## 1. Scope

### In the MVP
| Customer (web app on phone) | Shop owner (desktop app: Windows `.exe` + macOS `.dmg`) |
|---|---|
| Scan the shop's QR → the shop's upload page opens, no install, no login | Log in once; the app stays signed in |
| Upload one or more files (PDF, JPG, PNG, DOCX, PPTX) | **New jobs appear instantly** with a sound and notification |
| **Customize the order** (see §1a): pages, sequence, B&W or colour, copies, sides | See the queue: token, customer name, files, **exact print settings**, **price**, time |
| See the **price live** as they change settings, with a breakdown | **Preview inside the app**: zoom and scroll pages, no file saved to disk |
| Enter a name and press **Send to shop** | **Print** with the customer's settings already filled in (see §2, "How printing works") |
| Get a **token number** (e.g. `#A47`) and the **amount to pay at the counter** | Mark a job *Paid* and *Done*; files are deleted automatically |
| See status: *Sent ✓* / *Printing* / *Ready ✓* | Set the shop's **rate card** (B&W / colour, single / double sided) |
| | Show or print the shop's **QR code** from the app |

### Not in the MVP (later)
Online payment (in the MVP the customer pays the shown price at the counter by UPI or cash),
automatic printing without clicks, the convenience fee, owner earnings dashboard, several staff
accounts per shop.

---

## 1a. Order customization and pricing (customer web app)

### What the customer can set, for each file
| Option | How it looks | Example |
|---|---|---|
| **Pages to print** | "All pages" or a custom range field, plus tap-to-select page thumbnails | `1-5, 8, 10-12` |
| **Sequence** | Drag to **reorder files**; within a file, pages print in the order of the range typed (so `5-1` prints in reverse) | Front page first, then annexures |
| **B&W or colour** | One toggle for the whole file, **or mixed**: choose which pages are colour | Pages `1, 4` colour, the rest B&W |
| **Copies** | − / + stepper | 3 copies |
| **Sides** | Single sided / double sided (only shown if the shop's printer can print both sides) | Double sided |
| **Paper size** | A4 by default (A3 / Legal only if the shop turns them on) | A4 |

Page thumbnails come from the real converted PDF. The customer sees exactly which pages they
picked and what will print, and colour pages get a small colour badge.

### How the price is calculated
The shop owner sets a **rate card** in the desktop app, for example:

| | Single sided | Double sided |
|---|---|---|
| B&W, per page | ₹2 | ₹3 per sheet |
| Colour, per page | ₹10 | ₹18 per sheet |

```
for each file:
   bw_pages     = selected pages that are B&W
   colour_pages = selected pages that are colour
   file_price   = (bw_pages × bw_rate + colour_pages × colour_rate) × copies
                  (double sided: charged per sheet, using the double-sided rate)
order_total = sum of file_price  (rounded to the nearest rupee)
```

The customer sees a **live breakdown** that updates on every change:
```
Resume.pdf      3 pages B&W × 2 copies .......... ₹12
Project.docx    10 B&W + 2 colour × 1 copy ....... ₹40
-------------------------------------------------------
Total (pay at counter) ........................... ₹52
```

### Rules that keep the price honest
- **The page count comes from the server, not from the customer.** Every upload (including
  DOCX/PPTX) is converted to PDF before the customization screen opens, so the page count and
  price are always right. This is why Office file conversion moves up to **week 1–2**.
- **One shared pricing function** in `packages/shared` is used by the web app (live price),
  the server (final price) and the desktop app (display). The server recalculates the price
  when the order is sent, and **that price is final**. The browser's number is only a preview.
- The rate card in force is **saved with the order**, so changing rates later never changes
  the price of an order already sent.
- All money is stored as whole **paise** (integers), never as decimals.

---

## 2. Architecture

```
 Customer phone                     Cloud (Supabase)                        Shop PC
 ┌─────────────────┐   upload   ┌───────────────────────┐  realtime   ┌──────────────────────┐
 │ Web app         │──────────▶ │ Storage (private      │ ──────────▶ │ Desktop app          │
 │ /s/{shop-slug}  │            │  bucket, per shop)    │  new job    │ (Electron)           │
 │ (Next.js)       │──────────▶ │ Postgres: shops, jobs │             │  • queue list        │
 └─────────────────┘ create job │ Realtime: job events  │ ◀────────── │  • in-app PDF viewer │
                                │ Auth: shop owners     │  status     │  • print button      │
                                └──────────┬────────────┘             └──────────────────────┘
                                           │ DOCX/PPTX → PDF
                                    ┌──────▼──────┐
                                    │ Gotenberg   │ (week 3)
                                    └─────────────┘
```

### Why these choices
- **Supabase** provides database, file storage, realtime push and login in one service. We don't
  have to build or host a backend server for the MVP, which saves weeks. The free tier is enough
  for a pilot.
- **Electron** builds **both the Windows `.exe` and the macOS `.dmg` from one TypeScript codebase**
  (`electron-builder`). It also ships Chromium, so PDF preview and printing work the same on both.
- **Next.js** for the customer page. It is fast on cheap Android phones and deploys free on Vercel.

### How "preview without downloading" works
The app does have to fetch the file's bytes, since nothing can display a file without them.
But it **streams the file straight into memory** over a short-lived signed URL and draws it with
**PDF.js** inside the app. Nothing goes to the Downloads folder, there is no "Save as", and nothing
is left on the shop PC after the job is closed. To the owner it feels like opening a chat
attachment, not downloading a file.

### How printing works
- When an order is sent, the server builds a **print-ready PDF** for each file. It keeps only the
  selected pages, puts them in the chosen order, and splits mixed jobs into a
  **B&W part and a colour part**. The owner therefore never has to type page ranges.
- The **Print** button calls Electron's `webContents.print()` with the customer's settings
  already applied: `copies`, `color: true/false`, `duplexMode`, `pageSize`. The owner only
  picks the printer (remembered after the first time) and clicks Print.
  A mixed order prints as two clicks: **"Print B&W part"** and **"Print colour part"**.
  If the shop has two printers, each part goes to the matching printer.
- Phase 2 removes the click too, with silent automatic printing (SumatraPDF on Windows, `lp` on
  macOS).

---

## 3. Data model (Supabase Postgres)

```sql
shops (
  id uuid pk, owner_id uuid -> auth.users, name text, slug text unique,
  is_accepting bool default true, created_at timestamptz
)

shop_rates (
  shop_id uuid -> shops, paper_size text default 'A4',
  color_mode text check (color_mode in ('bw','color')),
  sides text check (sides in ('single','double')),
  price_paise int                                           -- per page (single) / per sheet (double)
)

jobs (
  id uuid pk, shop_id uuid -> shops, token text,            -- "A47", resets daily
  customer_name text, note text,
  status text check (status in ('draft','new','opened','printing','ready','done','expired')),
  total_paise int,                                          -- final, calculated on the server
  rates_snapshot jsonb,                                     -- rate card used for this order
  paid_at_counter bool default false,
  created_at timestamptz, printed_at timestamptz
)

job_files (
  id uuid pk, job_id uuid -> jobs, position int,            -- file order (sequence)
  storage_path text, original_name text, mime text, size_bytes int,
  pdf_path text, page_count int,                            -- converted PDF + real page count
  page_sequence int[],                                      -- e.g. {1,2,3,5,4}: what prints, in order
  color_pages int[],                                        -- pages from page_sequence printed in colour
  copies int default 1, sides text, paper_size text,
  price_paise int,
  bw_print_path text, color_print_path text                 -- print-ready PDFs built on submit
)
```

**Row-level security (RLS)**
- Anyone (anonymous) can **create** a job and upload files, but only for a shop that has
  `is_accepting = true`, only into `shop/{shop_id}/{job_id}/`, and never read them back.
- Only the shop's owner can **read** its jobs and files, update their status, or delete them.
- The customer's status page reads a single job through a public, limited view keyed by
  `job.id`, which is an unguessable UUID.

**Cleanup:** a scheduled function deletes files **2 hours after `done`**, or after **24 hours**
whatever the status.

---

## 4. Repository layout

```
/
├─ apps/
│  ├─ web/        # Next.js customer upload page + status page
│  └─ desktop/    # Electron + React (Vite): queue, viewer, print, QR, login
├─ packages/
│  └─ shared/     # TS types, Supabase client helpers, file rules (types/size limits)
├─ supabase/
│  ├─ migrations/ # SQL schema + RLS policies
│  └─ functions/  # cleanup cron, DOCX→PDF conversion trigger
├─ PLAN.md        # full long-term vision (Phase 2+)
└─ MVP_PLAN.md    # this file
```

---

## 5. Milestones (about 5 weeks for one developer)

| Week | Milestone | Done when… |
|---|---|---|
| 1 | **Foundations + upload** | Monorepo set up; Supabase project with schema and RLS; customer page `/s/{slug}` uploads files with a progress bar; DOCX/PPTX converted to PDF (Gotenberg) with real page counts |
| 2 | **Customize + price** | Thumbnails, page ranges and sequence, file reorder, B&W/colour/mixed, copies, sides; shared pricing function with unit tests; live price breakdown; server-side final price; token + "pay ₹X at counter" screen |
| 3 | **Desktop app core** | Electron app: owner login, rate card editor, realtime queue (new job within about 1 second with a sound), in-app preview, print-ready B&W/colour PDFs, Print with settings pre-filled, mark Paid/Done; customer status updates live |
| 4 | **Packaging + shop setup** | Signed `.exe` (NSIS installer) and `.dmg`; auto-update; shop onboarding (name → slug → QR poster PDF); "pause uploads" toggle; auto-cleanup job |
| 5 | **Pilot** | Installed in 2–3 real shops; feedback fixed; basic analytics (jobs per day, time from upload to print) |

**Pilot success:** owners stop asking customers to WhatsApp or email files. Measure the share of
daily jobs that come through the QR, the median time from upload to print, and zero lost or
mixed-up files.

---

## 6. Things to know up front

| Topic | Note |
|---|---|
| **Code signing** | Without signing, Windows shows a SmartScreen warning and macOS blocks the app. For the pilot we can install it ourselves and click past the warnings. For public release you need an Apple Developer account (about $99 a year, for notarization) and a Windows code-signing certificate. |
| **File limits** | 25 MB per file, 10 files per job, allowed types checked by both extension and file contents (magic bytes) |
| **Privacy** | Files are private (signed URLs only), deleted automatically, customers are anonymous (name only). We tell customers this on the upload page ("deleted after printing"), which builds trust. |
| **Mix-ups** | The token number is shown large on the customer's phone and in the owner's queue; the owner calls out the token |
| **Spam uploads** | Rate limit per IP and per shop; the owner can pause uploads; jobs expire after 24h |
| **Offline shop PC** | The upload still succeeds (the file waits in the cloud); the queue syncs when the app reconnects |

---

## 7. Path to Phase 2 (full vision)

The MVP is set up so the following can be added without a rewrite (see [`PLAN.md`](./PLAN.md)):
1. **Online payment** (Razorpay UPI and split payouts): the price is already calculated on the
   server, so this adds a "Pay ₹X" step in place of "pay at counter".
2. **Auto-print**: the desktop app already receives jobs in real time, so a setting
   "print automatically after payment" switches to silent printing.
3. **Convenience fee** and owner earnings dashboard.

---

## 8. Decisions needed before week 1

1. **Product name and domain** for the QR link (e.g. `printdrop.in/s/sharma-xerox`).
2. **Supabase** (fast, recommended) or our own Node backend (more control, slower to build).
3. Does a customer need to give a **phone number**, or is a name enough? (Name only is recommended for the MVP.)
4. **Pilot shops**: which 2–3 shops, and do they use Windows or Mac? This decides which installer we polish first.
