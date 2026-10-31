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
| Upload one or more files (PDF, JPG, PNG; DOCX/PPTX in week 3) | **New files appear instantly** with a sound and notification |
| Enter a name and an optional note ("2 copies, colour, pages 1–5") | See the queue: token, customer name, files, page count, note, time |
| Get a **token number** (e.g. `#A47`) to tell the owner | **Preview inside the app**: zoom and scroll pages, no file saved to disk |
| See upload status: *Sent ✓* / *Printed ✓* | **Print** from the preview (system print dialog: printer, copies, B/W, range) |
| | Mark a job *Done*; files are deleted automatically |
| | Show or print the shop's **QR code** from the app |

### Not in the MVP (later)
Online payment, automatic printing without clicks, pricing, the convenience fee, owner
earnings dashboard, several staff accounts per shop.

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
- The **Print** button renders the PDF in a hidden window and calls Electron's
  `webContents.print()`. This opens the normal system print dialog, where the owner picks the
  printer, copies, colour/B&W and page range, the same on Windows and macOS.
- The customer's note (e.g. "2 copies, colour") is pre-filled where possible.
- Phase 2 replaces this with silent automatic printing (SumatraPDF on Windows, `lp` on macOS).

---

## 3. Data model (Supabase Postgres)

```sql
shops (
  id uuid pk, owner_id uuid -> auth.users, name text, slug text unique,
  is_accepting bool default true, created_at timestamptz
)

jobs (
  id uuid pk, shop_id uuid -> shops, token text,            -- "A47", resets daily
  customer_name text, note text,
  status text check (status in ('uploading','new','opened','printed','done','expired')),
  created_at timestamptz, printed_at timestamptz
)

job_files (
  id uuid pk, job_id uuid -> jobs, storage_path text, original_name text,
  mime text, size_bytes int, page_count int, pdf_path text  -- converted copy for DOCX etc.
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

## 5. Milestones (about 4–5 weeks for one developer)

| Week | Milestone | Done when… |
|---|---|---|
| 1 | **Foundations + upload** | Monorepo set up; Supabase project with schema and RLS; customer page `/s/{slug}` uploads a PDF/image with progress bar and shows a token |
| 2 | **Desktop app core** | Electron app: owner login, realtime queue (new job appears within about 1 second with a sound), in-app PDF/image preview, Print button, mark Done |
| 3 | **Office files + polish** | DOCX/PPTX/XLSX converted to PDF (Gotenberg) so the preview matches the printout; page counts; customer status page updates live to *Printed ✓* |
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
1. **Pricing + payment** (Razorpay UPI and split payouts): add a `price` step before upload completes.
2. **Auto-print**: the desktop app already receives jobs in real time, so a setting
   "print automatically after payment" switches to silent printing.
3. **Convenience fee** and owner earnings dashboard.

---

## 8. Decisions needed before week 1

1. **Product name and domain** for the QR link (e.g. `printdrop.in/s/sharma-xerox`).
2. **Supabase** (fast, recommended) or our own Node backend (more control, slower to build).
3. Does a customer need to give a **phone number**, or is a name enough? (Name only is recommended for the MVP.)
4. **Pilot shops**: which 2–3 shops, and do they use Windows or Mac? This decides which installer we polish first.
