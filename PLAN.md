# The Print's Project — Build Plan

> Scan → Upload → Pay → It prints. No queue, no pen drive, no WhatsApp, no cash.

This document is the technical and product plan for taking the idea from an empty
repo to a pilot running in real print shops.

---

## 1. Goals and non-goals

**MVP goals**
- A customer can go from scanning the counter QR to having pages in hand in **under 60 seconds**, with no app install and no login.
- The shop owner does **nothing** per job: no mouse, no cash, no file handling.
- The shop owner gets **exactly their rate** per page, settled to their bank automatically.
- The platform earns a **flat ₹2–₹5 convenience fee** per order.
- Customer files are **never kept** longer than needed to print them.

**Non-goals for v1** (later phases)
- Binding, lamination, photo prints, or any job that needs a person.
- Uploading from home with pickup later (possible later; v1 assumes the customer is at the counter).
- Supporting several printers per shop with smart routing (v1: one B/W printer plus an optional colour printer).
- macOS agent (most Indian print shops run Windows; Linux/mac come later).

---

## 2. System overview

```
 ┌──────────────┐  scan QR   ┌──────────────────────┐     ┌──────────────────┐
 │ Customer     │──────────▶ │ Web app (PWA)        │────▶│ API server       │
 │ phone        │  upload,   │ /s/{shopSlug}        │     │ (orders, pricing,│
 └──────────────┘  pay       └──────────────────────┘     │  shops, agents)  │
        │                                                  └──────┬───────────┘
        │ UPI / card                                              │
        ▼                                                         │ events
 ┌──────────────┐  webhook (payment.captured)                     │
 │ Razorpay     │────────────────────────────────────────────────▶│
 │ (+ Route     │◀── transfer to shop's linked account ──────────│
 │  split)      │                                                 │
 └──────────────┘                                                 ▼
                         ┌─────────────────┐  signed URL   ┌──────────────┐
                         │ Object storage  │◀──────────────│ WebSocket    │
                         │ (S3 / R2)       │               │ gateway      │
                         └────────┬────────┘               └──────┬───────┘
                                  │ download                       │ outbound WSS
                                  ▼                                ▼
                         ┌────────────────────────────────────────────────┐
                         │ Print Agent (Windows tray app on shop PC)      │
                         │  → silent print to local printer → status back │
                         └────────────────────────────────────────────────┘
```

Key decisions:
1. **The agent only makes outbound connections** (WSS, with HTTPS polling as a fallback). No port forwarding and no static IP, so it works behind any shop router or mobile hotspot.
2. **Every upload is turned into a PDF on the server before pricing.** The page count the customer pays for is the page count that prints, and the agent only ever has to print PDFs.
3. **Split payments go through a payment gateway** (Razorpay Route, or Cashfree Easy Split as the alternative). The platform never holds the shop's money in its own account, which keeps it clear of RBI payment-aggregator licensing.
4. **The shop's share is held until printing is confirmed.** The transfer to the shop is created `on_hold` and released only when the agent reports `PRINTED`. If printing fails, the customer gets an automatic refund.

---

## 3. Tech stack (recommended)

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo, TypeScript everywhere | Types shared across web, API and agent |
| Customer web app | Next.js (App Router) PWA, Tailwind | Fast on cheap Android phones, no install |
| Shop owner dashboard | Same Next.js app at `/dashboard` | One deploy |
| API | Node + Fastify (or Next route handlers at first), Zod validation | Simple, typed |
| Realtime to agents | WebSocket server (`ws`), Redis pub/sub once there is more than one instance | Instant job push |
| DB | PostgreSQL (Supabase or Neon) + Prisma/Drizzle | Relational order/ledger data |
| Queue / jobs | BullMQ on Redis (conversion, refunds, cleanup) | Retries, delays |
| File storage | Cloudflare R2 or S3, presigned PUT/GET, 24h lifecycle rule | Cheap, auto-expiry |
| Doc → PDF | Gotenberg (LibreOffice + Chromium in Docker) | DOCX/PPTX/XLSX/images → PDF |
| PDF tools | `pdf-lib` / `qpdf` (page count, ranges, thumbnails via `pdftoppm`) | Preview and accurate counts |
| Payments | Razorpay Standard Checkout (UPI intent, cards) + **Route** | UPI-first, split settlements |
| Print agent | **Tauri (Rust)** tray app, or Electron if speed of development matters more | Small installer, auto-update |
| Silent printing (Windows) | Bundled **SumatraPDF** `-print-to "<printer>" -print-settings "1-3,monochrome,duplex"` | Reliable, no dialogs |
| Silent printing (Linux, later) | CUPS `lp -d <printer> -o ...` | Built in |
| Hosting | Vercel (web) + Fly.io / Railway (API, WS, Gotenberg) + managed Redis | Low ops |
| Observability | Sentry, simple uptime and heartbeat alerts | Catch offline agents early |

---

## 4. Core flows

### 4.1 Shop onboarding (done once by us or the owner)
1. Owner signs up with phone OTP → creates a shop (name, address, hours).
2. Sets **rates**: B/W single side, B/W double side, colour single and double, per page for A4 (A3 later).
3. **KYC and bank account** → we create a Razorpay Route *linked account* for the shop.
4. Installs the **Print Agent** → it shows a 6-digit **pairing code** → owner types it in the dashboard → the agent receives a long-lived device token.
5. In the agent, owner chooses the **B/W printer** and **colour printer** from the local printer list → test print.
6. Dashboard creates a **printable QR standee** (PDF) that links to `https://<domain>/s/{shopSlug}`.

### 4.2 Customer order
1. Scans QR → shop page loads with a live status badge: 🟢 *Accepting orders* or 🔴 *Printer offline* (if the agent heartbeat is older than 60s, ordering is disabled).
2. Uploads one or more files (PDF, DOCX, PPTX, JPG/PNG; limit around 25 MB per file) **directly to storage** using a presigned URL.
3. Server converts each file to PDF → returns page count and thumbnails.
4. Customer picks for each file: page range, copies, B/W or colour, single or double sided (only if the shop's printer supports duplex).
5. **Price breakdown** is shown live and calculated again on the server:
   `print cost (shop's rates × pages × copies) + convenience fee (₹2–₹5) = total`
6. Pays through Razorpay Checkout (UPI intent first on mobile; cards and netbanking also offered).
7. Customer sees an **order token** (e.g. `#A47`) and live status: *Paid → Sent to printer → Printing → Done, collect from the tray.*

### 4.3 Payment → print
1. Razorpay `payment.captured` **webhook** (signature checked, handled idempotently) → order `PAID`.
2. Route transfer to the shop's linked account is created `on_hold`.
3. API pushes `job.new` to the shop's agent over WSS (or the agent picks it up on its next poll).
4. Agent sends `ACK` → downloads the PDF using a short-lived signed URL → prints with the chosen settings → reports `PRINTING` → `PRINTED` (or `FAILED` with a reason).
5. On `PRINTED`: release the hold on the transfer, delete the file, notify the customer.
6. On `FAILED`, or no ACK within around 2 minutes: retry once, then alert the owner and **auto-refund** the customer (the convenience fee is refunded too).

### 4.4 Order state machine
```
CREATED ─▶ AWAITING_PAYMENT ─▶ PAID ─▶ DISPATCHED ─▶ PRINTING ─▶ PRINTED ─▶ (file purged)
                │                 │          │            │
                ▼                 ▼          ▼            ▼
             EXPIRED          REFUNDING ◀── FAILED ◀──────┘
                                  │
                                  ▼
                              REFUNDED
```
Every change is written to an `order_events` table so there is a full audit trail.

---

## 5. Data model (first version)

- **shops**: id, slug, name, address, owner_user_id, status, hours, razorpay_linked_account_id, convenience_fee_paise
- **shop_rates**: shop_id, paper_size, color_mode, sides, price_per_page_paise
- **users**: id, phone, role (`owner` | `admin`). Customers stay anonymous; their phone number is optional and used only for receipts.
- **agents**: id, shop_id, device_token_hash, version, last_heartbeat_at, os, printers_json
- **printers**: id, agent_id, system_name, role (`bw` | `color`), supports_duplex, supports_color, enabled
- **orders**: id, shop_id, token, status, print_amount_paise, fee_amount_paise, total_paise, razorpay_order_id, razorpay_payment_id, customer_phone?, created_at
- **order_items**: id, order_id, storage_key, original_name, page_count, page_range, copies, color_mode, sides, printable_pages, amount_paise
- **order_events**: order_id, from_status, to_status, actor (`system` | `agent` | `webhook` | `admin`), meta_json, at
- **payouts / ledger**: order_id, transfer_id, amount_paise, status (`on_hold` | `released` | `reversed`)

All money is stored as **integer paise**.

---

## 6. The print agent (the hardest part, so start here)

**Responsibilities**
- Pair with a shop; store the device token in the OS credential store.
- Keep a WSS connection with reconnect and exponential backoff; send a heartbeat every 20s that includes printer status.
- List local printers and their capabilities (colour, duplex).
- Pull jobs, download, print silently, report status; **never print the same job twice** (keep a local job journal on disk keyed by job id).
- Start automatically at login, sit in the system tray, auto-update (Tauri updater or electron-updater).
- Show a small "today's jobs and earnings" window for the owner.

**Printing on Windows**
- Ship SumatraPDF next to the agent (it is open source, GPLv3, and redistributable as a separate binary).
- `SumatraPDF.exe -silent -print-to "HP LaserJet" -print-settings "1-4,7,monochrome,duplexlong,2x" file.pdf`
- Read job and printer status through the Windows print spooler API (`EnumJobs` / WMI `Win32_PrintJob`) so the agent knows the job really reached the spooler. "Printed" here means *the spooler accepted and finished the job*; paper jams are detected only on a best-effort basis.

**Edge cases to handle**
- Printer offline, out of paper or out of toner → report `FAILED`, refund, show a banner in the shop dashboard.
- Shop PC asleep or switched off → heartbeat goes stale → the QR page stops accepting orders.
- Internet drops in the middle of a job → the local journal stops a duplicate print after reconnecting.
- Several customers at once → a FIFO queue inside the agent, one job at a time per printer.

**Proof of concept first:** before building anything else, build a throwaway agent that receives a PDF over WebSocket and prints it silently on a real shop printer with B/W, duplex and page-range settings. This is where the project carries the most technical risk.

---

## 7. Payments and money flow

Example: 10 B/W pages at ₹2 per page, convenience fee ₹3.

| Item | Amount |
|---|---|
| Customer pays | ₹23.00 |
| Transfer to shop (Route, held until printed) | ₹20.00 |
| Platform keeps | ₹3.00 − gateway fees |

**Watch the gateway fee.** Card and wallet fees (around 2%) and Route transfer fees can eat a large share of a ₹3 fee on small orders.
- Push UPI hard, since UPI payments to merchants usually have lower or zero MDR depending on the gateway plan. Confirm the actual pricing with Razorpay or Cashfree before launch.
- Choose the fee rule carefully: for example, a flat ₹2 up to ₹50 and ₹5 above that, or pass card fees on as a surcharge.
- Possibly set a minimum order value (e.g. ₹5).

**Compliance**
- Use a gateway's marketplace or split product (Razorpay Route / Cashfree Easy Split) so the platform never takes custody of the shop's money.
- Shop KYC is handled through the gateway's linked-account onboarding.
- GST: the platform's convenience fee is a taxable service; work out invoicing with a CA.
- Reconciliation job every night: gateway settlements compared against `orders` and `ledger`.

---

## 8. Security and privacy

- Files are encrypted at rest (storage default). Signed URLs are short-lived (5 min) and scoped to one object.
- **Files are deleted right after `PRINTED`**, with a 24h storage lifecycle rule as a backstop. Thumbnails are deleted too.
- The agent authenticates with a per-device token (stored hashed on the server) that the owner can revoke from the dashboard.
- Webhook signatures are verified; all payment handlers are idempotent.
- Upload checks: allowed MIME types and magic bytes, size limits, conversion runs in a sandbox (the Gotenberg container has no network access).
- Follow India's **DPDP Act 2023**: collect very little data (customers are anonymous), publish a privacy notice, and state the deletion policy openly. This is also a selling point: "your files are deleted the moment they print".
- Abuse controls: rate limits per IP and per shop; only accept orders while the shop is open and the agent is online; the owner can pause the queue with one tap.

---

## 9. Shop owner dashboard (MVP scope)

- Live queue: token, pages, status, and a reprint or refund button.
- Today's, this week's and lifetime earnings; payout history from the gateway.
- Rate card editor and shop hours.
- Agent and printer health (online/offline, last heartbeat, version).
- QR standee download.
- Pause or resume accepting orders.

---

## 10. Repository layout

```
/
├─ apps/
│  ├─ web/          # Next.js: customer PWA (/s/[slug]) + owner dashboard (/dashboard)
│  ├─ api/          # Fastify REST + WebSocket gateway + webhooks
│  ├─ worker/       # BullMQ: conversion, refunds, cleanup, reconciliation
│  └─ agent/        # Tauri (or Electron) Windows print agent
├─ packages/
│  ├─ shared/       # Zod schemas, order state machine, pricing function, WS protocol types
│  └─ db/           # Prisma/Drizzle schema + migrations
├─ infra/           # docker-compose (postgres, redis, gotenberg, minio) for local dev
└─ PLAN.md
```

The **pricing function** and the **state machine** live in `packages/shared` so the web app, API and tests all use the same logic. The server's price is always the one charged.

---

## 11. Milestones

| # | Milestone | Deliverable | Est. |
|---|---|---|---|
| 0 | **Printing proof of concept** | Script/agent that gets a PDF over WS and prints it silently with B/W, duplex and range settings on a real printer | 3–4 days |
| 1 | Foundations | Monorepo, docker-compose dev stack, DB schema, shared pricing and state machine with unit tests | 1 week |
| 2 | Customer flow (no payment yet) | QR page → upload → convert → preview → configure → price | 1–1.5 weeks |
| 3 | Agent v1 | Pairing, WSS + heartbeat, printer selection, job journal, status reporting, installer | 1.5–2 weeks |
| 4 | Payments | Razorpay Checkout + webhooks + Route linked accounts + hold/release + auto-refund | 1–1.5 weeks |
| 5 | Owner dashboard | Queue, earnings, rates, agent health, QR generator, pause | 1 week |
| 6 | Hardening | File purge, rate limits, Sentry, offline alerts, reconciliation, end-to-end tests (Playwright) | 1 week |
| 7 | **Pilot** | 2–3 real shops near a college; measure, fix, repeat | 2–4 weeks |

That is roughly **8–10 weeks to a pilot** for one or two developers.

### Pilot success metrics
- Time from scan to printed under 60s (median).
- Print success rate over 98%; every failure refunded automatically within 5 minutes.
- Zero cases where the shop got the wrong amount.
- Each shop handles at least 30% of its daily jobs through the QR within 2 weeks.
- Shop owner NPS; agent uptime during open hours.

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Silent printing differs from one printer driver to another | Do the proof of concept on the 3–4 most common shop printers (HP, Canon, Epson, Brother); keep a compatibility list |
| Gateway fees eat into the convenience fee | Default to UPI; adjust fee bands; negotiate pricing once volume grows |
| Shop PC is off or asleep | Heartbeat gating on the QR page, "keep awake" option in the agent, SMS/WhatsApp alert to the owner |
| Customer takes someone else's printout | Order token shown on the phone; optionally print a small token cover sheet first |
| Remote or prank orders through a static QR | Accept orders only during shop hours with the agent online; they are prepaid anyway; rotating QR as an option later |
| DOCX formatting changes after conversion | Always show the PDF preview before payment, so what you see is what prints |
| Owner sees the system as a threat to cash income | The pitch: the same rate, no change counting, a shorter queue, and more customers served per hour |

---

## 13. Later phases

- Upload from home and collect later, with an order-ahead pickup code.
- Several printers per shop, with A3, photo paper and automatic routing.
- WhatsApp bot entry point ("send your file to this number").
- Paid premium tier for shops (analytics, branding, customer SMS).
- Network discovery page: "print shops near me with a printer online now".
- Linux/macOS agent; a Raspberry Pi "print box" for shops without a PC.

---

## 14. Open questions (need decisions)

1. **Payment gateway**: Razorpay Route or Cashfree Easy Split? Compare onboarding friction for small shops and per-transfer fees.
2. **Agent framework**: Tauri (smaller and faster, but Rust) or Electron (all TypeScript, but a larger installer)?
3. **Fee model**: flat ₹3, bands (₹2 / ₹5), or a percentage with a floor?
4. **Who installs the agent** during the pilot? Probably us, in person.
5. **Brand name and domain** for the QR URL.
