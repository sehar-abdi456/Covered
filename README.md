# Covered

> **You already paid for the coverage. Covered files the claim for you.**

Covered watches a card member's transactions, detects when a purchase qualifies
for a card protection benefit (purchase protection, return protection, trip
delay), matches it to the right benefit + limit + deadline, notifies the member,
pre-fills the claim, and lets them submit in one tap.

**Covered never approves a claim.** It only *detects*, *matches*, and
*pre-fills*. Real adjudication is a separate, unchanged system (mocked here).

This repo is a **working end-to-end prototype**: a real backend running a real
detection pipeline over a seeded dataset, a real React frontend that calls real
endpoints, and clearly-separated stubs for every external dependency we don't
have credentials for.

---

## Quick start

Requires Node 18+ (built and tested on Node 22).

```bash
# 1. Install both apps
npm run install:all         # or: npm --prefix backend install && npm --prefix frontend install

# 2. Run backend + frontend together
npm run dev                 # backend :4000, frontend :5173
```

Then open **http://localhost:5173** and click **Start transaction feed**.

Prefer two terminals?

```bash
npm run backend             # http://localhost:4000
npm run frontend            # http://localhost:5173
```

Want to see the engine work with **no UI at all**? This prints every
transaction's routing decision + the duplicate/abuse results to the console:

```bash
npm run verify
```

Seed data (24 transactions + entitlement rules) loads automatically on boot —
there is **no manual data entry**.

---

## The five-step flow (what the demo shows)

1. **Detect** — the mock stream emits each transaction; the Detection Engine
   reads it.
2. **Match** — the rules engine finds the right benefit, coverage limit, and
   filing deadline for that exact card/product.
3. **Tell the member** — a "Covered" card appears in the Live feed
   ("Covered up to $1,000 · file by Oct 22 · 88 days left").
4. **Pre-fill** — tapping the card opens a claim already filled in (card last-4,
   merchant, amount, date, benefit, limit, deadline). The member only adds
   *what happened* + *a photo*.
5. **Submit & track** — one tap submits into the (mocked) claims system; the
   member watches status advance **Submitted → In review → Decision** and sees
   it in the Benefits tab.

---

## Architecture

```
Prototype/
├── backend/
│   ├── server.js                # Express REST API
│   ├── db.js                    # SQLite data layer (entitlements/transactions/claims)
│   ├── verify.js                # console-verifiable pipeline proof (npm run verify)
│   ├── seed-data/
│   │   ├── entitlements.json    # machine-readable T&Cs — the RULE PACK
│   │   └── transactions.json    # 24 seeded transactions (all the demo cases)
│   ├── engine/
│   │   ├── rulesEngine.js        # deterministic, JSON-configured eligibility
│   │   ├── classifier.js         # ML-style classifier STUB (predict → {category, confidence})
│   │   └── detectionEngine.js    # orchestrates rules + classifier + confidence routing
│   ├── claims/
│   │   ├── claimsLayer.js         # builds drafts, submits, tracks status
│   │   └── duplicateCheck.js      # duplicate/abuse guard
│   ├── stream/
│   │   └── streamEmitter.js       # mock "Kafka" transaction feed (EventEmitter)
│   └── stubs/
│       ├── flightStatus.js        # flight-status API stub
│       ├── eReceipt.js            # e-receipt / line-item connector stub
│       ├── adjudication.js        # Amex claims/adjudication black-box stub
│       └── (entitlements.json is the T&C source stub)
└── frontend/                    # React + Vite
    └── src/
        ├── api.js               # the ONLY place the UI talks to the backend
        └── components/
            ├── LiveFeed.jsx      # "Covered" notification cards
            ├── ClaimReview.jsx   # pre-filled claim + submit + status tracker
            ├── Benefits.jsx      # coverages + claims + live statuses
            └── DebugView.jsx     # per-transaction rule trace (proves the engine)
```

### Pipeline (per transaction)

```
mock stream ──▶ Detection Engine ──▶ route:
                 │  1. classifier.predict()  → {category, confidence}
                 │  2. rulesEngine.evaluateEligibility() against entitlements.json
                 │  3. flightStatus stub (travel benefits only)
                 ▼
   eligible + high confidence  → "eligible"       (auto-draft a claim)
   eligible + low  confidence  → "quick_confirm"  (member confirms in 1 tap)
   ineligible                  → "ineligible"     (dropped silently, no nudge)
```

---

## What's real vs. stubbed

| Component | Real or stub | What a production version would need |
|---|---|---|
| Transaction stream | **Stub** — in-process `EventEmitter` walking a seed file on a timer | A Kafka / Amazon MSK consumer on the live authorization feed |
| Rules engine | **Real logic**, prototype-grade | Same shape, hardened; likely OPA (Rego) or Drools reading the same rule packs |
| ML classifier | **Stub** — deterministic keyword scoring behind a `predict()` interface | A trained model (scikit-learn / PyTorch) served behind an inference endpoint; same `predict()` call site |
| Entitlements / T&Cs | **Stub** — hand-authored `entitlements.json` | A machine-readable T&C store generated from benefit-guide PDFs, versioned & reviewed by benefits-ops |
| Claims layer | **Real logic** | Same shape, wired to the real claims intake API |
| Duplicate / abuse guard | **Stub** — checks existing claims + transaction flags | A fraud/abuse service (velocity rules, merchant-refund + warranty cross-checks) |
| Data layer | **Real (SQLite, in-memory)** | MySQL (system of record) + DynamoDB/Redis (fast reads) + a warehouse |
| Flight-status API | **Stub** — canned results in `flightStatus.js` | FlightAware AeroAPI / Cirium; swap the one `getFlightStatus()` body |
| E-receipt connector | **Stub** — canned line items | A merchant receipt feed / email-receipt parser, requested only when needed |
| Adjudication system | **Stub** — in-memory state machine that advances status over time | The real Amex claims/adjudication system (a black box Covered submits into) |
| Auth | **None** (single demo card member) | Real card-member auth/session |

Every stub file starts with a comment block stating exactly what it replaces and
what would change to make it real.

---

## 60–90 second demo script

Read this out loud while recording.

1. **"Covered watches your card feed."** Click **Start transaction feed**.
   Transactions stream in; "Covered" cards pop up as eligible purchases are
   detected — no page refresh.
2. **"Here's the hero case."** Point at the **Apple · $1,199 · MacBook Air**
   card: *"Covered up to $1,000, file by Oct 22, 88 days left."* Every number
   came from the backend.
3. **"The member did nothing — but if something goes wrong, one tap."** Click
   **Tap if something went wrong**. The claim is **already pre-filled**: card,
   merchant, amount, date, benefit, coverage limit, deadline.
4. **"The member only adds two things."** Pick *What happened* → *Item was
   damaged*, attach a photo, click **Submit claim**.
5. **"One tap, and it's in the claims system."** A reference number appears
   (e.g. **PP-4821**) and the tracker shows **Submitted → In review →
   Decision**. *"Covered never approves it — adjudication happens downstream."*
6. **"It tracks itself."** Open the **Benefits** tab — the claim is there and its
   status advances on its own (Submitted → In review → Decision · Approved).
7. **"And it doesn't just approve everything."** Open **Engine (debug)**:
   Whole Foods (perishables), Hertz (vehicles), Ticketmaster (tickets), and an
   **on-time American Airlines flight** are all **DROPPED**; Costco/Amazon/Target
   route to **QUICK CONFIRM**. Click any row for the rule-by-rule reason.
8. *(optional)* **"And it blocks abuse."** File a claim on the **Samsung** card
   (already refunded) → it's rejected: **ALREADY_REFUNDED**.

---

## API reference

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/transactions` | All transactions with evaluation status |
| `POST` | `/transactions/stream/start` · `/stop` | Control the mock live feed |
| `GET` | `/transactions/stream/status` | Running state + pending count |
| `GET` | `/coverages` | Currently-detected eligible coverages |
| `GET` | `/claims/:transactionId/draft` | Pre-filled claim draft |
| `POST` | `/claims` | Submit a claim (runs the duplicate/abuse guard) |
| `GET` | `/claims/:reference/status` | Current claim status |
| `GET` | `/benefits` | Combined Benefits-tab view (coverages + claims + statuses) |
| `GET` | `/debug/evaluations` | Per-transaction rule trace (admin/debug) |

---

See **[JUDGE_CHEATSHEET.md](JUDGE_CHEATSHEET.md)** for the two technical
questions and exactly which files answer them.
