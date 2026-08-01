# Covered — Interview Prep (Python backend)

Everything you need to walk into an interview and defend this project end-to-end.
Read top-to-bottom once, then use the Q&A bank to drill. File/function names are
real — quote them, it signals you actually built it.

---

## 0. Table of contents
1. The 30-second and 2-minute pitch
2. What problem it solves (business framing)
3. Architecture at a glance
4. The pipeline: one transaction, end to end
5. Component-by-component deep dive
6. Python-specific implementation notes
7. Key design decisions & tradeoffs
8. Known limitations (own them before they ask)
9. The two signature questions
10. Full interview Q&A bank
11. Rapid-fire technical answers
12. If they ask you to extend it live

---

## 1. The pitch

**30 seconds:** "Covered turns the card protections you already pay for into
claims that file themselves. It watches your transactions, detects when a
purchase is covered by a benefit like purchase protection or trip-delay
insurance, matches it to the right limit and deadline, and pre-fills the claim so
filing is one tap. The important boundary: it never approves claims — it only
detects, matches, and pre-fills. Adjudication stays in the existing claims
system."

**2 minutes:** add the five-step flow (Detect → Match → Tell → Pre-fill →
Submit/Track), the fact that it's a *working* prototype with a real detection
pipeline over seeded data, and the two scalability/trust points: config-driven
benefits (new benefit = JSON entry, not code) and the hard separation between
detection and adjudication.

---

## 2. The problem (business framing)

- Premium cards bundle real benefits (purchase/return protection, trip delay).
- They go massively **underused**: members don't know the benefit exists, don't
  know their item qualifies, don't know the limit/deadline, and the forms are
  tedious. Billions in coverage goes unclaimed.
- For the issuer (Amex), activating these benefits drives **card loyalty and
  perceived value** without changing the underlying insurance product.
- Covered is the **activation layer** on top of benefits that already exist.

---

## 3. Architecture at a glance

```
                 ┌─────────────────────────────────────────────┐
   React (Vite)  │  Live feed · Claim review · Benefits · Debug │
   :5173  ───────┤  (proxies /api → :4000, unchanged for Py/Node)│
                 └───────────────────────┬─────────────────────┘
                                         │ REST
                 ┌───────────────────────▼─────────────────────┐
   FastAPI :4000 │  main.py  (endpoints, CORS, shaping)         │
                 └───┬───────────────┬──────────────┬──────────┘
                     │               │              │
        ┌────────────▼───┐   ┌───────▼───────┐  ┌───▼─────────────┐
        │ stream_emitter │   │ detection_    │  │ claims_layer     │
        │ (mock Kafka,   │──▶│ engine        │  │ build/submit/    │
        │  bg thread)    │   │  rules+ML+     │  │ track            │
        └────────────────┘   │  flight gate   │  └───┬────────┬────┘
                             └───┬───────┬────┘      │        │
                       ┌─────────▼──┐ ┌──▼────────┐  │  ┌─────▼──────┐
                       │ rules_engine│ │classifier │  │  │duplicate_  │
                       │ (JSON rules)│ │ (predict) │  │  │check       │
                       └─────────────┘ └───────────┘  │  └────────────┘
                                                      │
                          ┌───────────────────────────▼──────────────┐
                          │ stubs: flight_status · e_receipt ·        │
                          │ adjudication (the ONLY place status moves)│
                          └───────────────────────────────────────────┘
                                          │
                                   ┌──────▼──────┐
                                   │ db.py SQLite │  entitlements/transactions/claims
                                   └──────────────┘
```

**One-line role of each layer:**
- `main.py` — HTTP surface; no business logic beyond shaping responses.
- `stream_emitter.py` — replays the seeded feed on a timer (Kafka stand-in).
- `detection_engine.py` — the brain: orchestrates rules + classifier + flight gate, routes.
- `rules_engine.py` — deterministic eligibility from `entitlements.json`.
- `classifier.py` — fuzzy category + confidence (stub for a real ML model).
- `claims_layer.py` — drafts, submits, tracks.
- `duplicate_check.py` — fraud/abuse guard.
- `stubs/` — every external system we don't have credentials for.
- `db.py` — SQLite data layer.

---

## 4. The pipeline: one transaction, end to end

Take `txn_1001` (Apple, MacBook Air, $1,199, MCC 5732, Platinum):

1. **Stream emits it.** `stream_emitter._run()` pulls the next `status='new'` row
   and calls `_process_one()`.
2. **Classify.** `classifier.predict()` sees "Apple" → `{category: electronics,
   confidence: 0.95}`.
3. **Rules.** `rules_engine.evaluate_eligibility()` loops benefits:
   - purchase_protection: Platinum ✓, MCC 5732 in list ✓, category electronics
     not excluded ✓, amount ≥ 25 ✓, within 90-day window ✓ → **eligible**.
   - It's the first match, so it wins.
4. **Build coverage.** `build_coverage()` computes `coverage_limit =
   min(1199, 1000) = 1000`, `filing_deadline = purchase + 90d = 2026-10-22`,
   `days_left = deadline − today`.
5. **Route.** confidence 0.95 ≥ 0.7 → `status = "eligible"` (auto-draft).
6. **Persist.** the row's `status`, `benefit_type`, `coverage_json`,
   `confidence`, `trace_json` are written back.
7. **UI shows the card.** frontend polls `/coverages`, renders "covered up to
   $1,000 · file by Oct 22 · 88 days left."
8. **Member taps → draft.** `GET /claims/txn_1001/draft` → `build_draft()`
   re-evaluates and returns the pre-filled read-only fields + `editable_fields`.
9. **Submit.** `POST /claims` → `submit_claim()` runs `check_duplicate_or_abuse()`
   (passes), calls `submit_to_adjudicator()` → reference `PP-4821`, inserts the
   claim, flips the transaction to `claimed`.
10. **Track.** `GET /claims/PP-4821/status` → `get_adjudication_status()` returns
    status as a function of elapsed time: submitted → in_review (8s) → decision
    approved (20s).

---

## 5. Component-by-component deep dive

### `db.py` — Data Layer
- **In-memory SQLite** (`sqlite3.connect(":memory:", check_same_thread=False)`),
  one shared connection guarded by a `threading.Lock` in the `query()` helper.
- Three tables: `entitlements`, `transactions`, `claims`.
- `ENTITLEMENTS` is loaded from `seed_data/entitlements.json` at import and is the
  **source of truth for the rules engine** (the table copy is just to make the
  "data layer" real).
- Seeds 24 transactions (`status='new'`) + one pre-existing claim `PP-4820` for
  the duplicate demo.
- **Stands in for:** MySQL (system of record) + DynamoDB/Redis (fast reads) + a
  warehouse.

### `engine/rules_engine.py` — deterministic eligibility
- `evaluate_eligibility(txn, entitlements, classification)` loops every benefit,
  calls `_evaluate_benefit()`, returns the **first eligible** match + a full
  `trace` (per-benefit pass/fail reasons).
- `_evaluate_benefit()` checks: card product, MCC membership, excluded category,
  min amount, coverage window (days since purchase).
- `build_coverage()` derives payout cap (`min(amount, per_item_limit)`), coverage
  end, filing deadline, days left — **all from the JSON**.
- **Stands in for:** OPA (Rego) / Drools.

### `engine/classifier.py` — the ML stub
- `predict(transaction) -> {category, confidence}` via a keyword table.
- Confident merchants (Apple, Delta) score 0.90–0.97; deliberately ambiguous ones
  (Amazon, Costco, Target = "marketplace") score 0.45.
- **The interface is the point:** a real scikit-learn/PyTorch model drops in
  behind the same `predict()` with zero caller changes.

### `engine/detection_engine.py` — the orchestrator
- `evaluate_transaction()` = predict → evaluate_eligibility → (travel? flight
  gate) → route.
- **Routing:** eligible & confidence ≥ `HIGH_CONFIDENCE (0.7)` → `eligible`;
  eligible & low confidence → `quick_confirm`; else `ineligible`.
- Travel benefits get an extra **flight gate**: even a valid airline charge is
  dropped unless the flight was delayed ≥ threshold or cancelled.

### `claims/claims_layer.py`
- `build_draft()` — pre-fills the claim; marks only `what_happened` +
  `photo_filename` editable.
- `submit_claim()` — guard → adjudicator handoff → insert claim → mark txn
  claimed. Returns `{ok, reference}` or `{ok:false, code, reason}`.
- `get_claim_status()` / `list_claims()` — mirror the adjudicator's live status
  into the claims table on read.

### `claims/duplicate_check.py`
- Blocks: existing claim for the txn, `already_refunded` flag,
  `under_manufacturer_warranty_claim` flag. Returns a clear `code` + `reason`.

### `stream/stream_emitter.py`
- `TransactionStream` runs a **daemon thread**; every 1.5s it grabs the newest
  un-evaluated txn, evaluates, persists. `_stop` is a `threading.Event`.
- `drain_now()` evaluates everything immediately (used by `verify.py`).
- **Stands in for:** Kafka / Amazon MSK.

### `stubs/`
- `flight_status.py` — canned `get_flight_status(flight, date)`.
- `e_receipt.py` — canned line items, requested only when useful.
- `adjudication.py` — **in-memory state machine; the ONLY place claim status
  changes.** Status is a pure function of elapsed time; references are prefixed
  by benefit (PP/RP/TD).

### `main.py` — FastAPI
- Thin HTTP layer: endpoints + CORS + `shape_txn()` response shaping. All logic
  lives in the modules above.

---

## 6. Python-specific implementation notes

- **Framework:** FastAPI + Uvicorn (ASGI). Chosen for speed to build, automatic
  JSON handling, and being the modern Python default.
- **Concurrency model:** FastAPI endpoints are sync functions here; Uvicorn runs
  them in a threadpool. The stream runs on its **own daemon thread**. So multiple
  threads touch SQLite → hence the shared-connection + `Lock`.
- **Why `check_same_thread=False` + a Lock:** SQLite connections are bound to the
  creating thread by default. We share one connection across threads and
  serialize access with a lock — simple and correct for a prototype's load.
- **`@app.on_event("startup")`** prints the boot banner and count.
- **Reference/counter/registry are module-level globals** in `adjudication.py` —
  fine for a single Uvicorn worker (see limitations for the multi-worker caveat).
- **Dates:** timestamps are ISO-8601 UTC; parsed with `datetime.fromisoformat`
  after swapping `Z`→`+00:00`. `days_left` uses `datetime.now(timezone.utc)`, so
  it's a live value that decreases over real time (correct, not a bug).

---

## 7. Key design decisions & tradeoffs

| Decision | Why | The tradeoff / what I'd change at scale |
|---|---|---|
| **Rules first, ML only for ambiguity** | Deterministic, auditable core; ML is a compliance risk if it decides eligibility alone | ML confidence only *routes* (auto vs confirm); it never overrides a rule |
| **Config-driven entitlements (JSON)** | New benefit = new config, reviewed by benefits-ops, not engineering | Real system: versioned rule store + OPA/Drools |
| **Detection ≠ adjudication** | Trust/compliance: we must not decide payouts | Status only moves in the adjudication stub |
| **Pull-based claim status** (pure function of elapsed time) | No background timers, no drift, trivially correct | Real system is event-driven (webhooks); I'd subscribe instead of poll |
| **In-memory SQLite** | Zero setup, deterministic demo every boot | No persistence; production = MySQL + cache + warehouse |
| **Single connection + Lock** | Simplest correct concurrency for the demo | Serializes DB access; production = connection pool / real DB |
| **First-eligible-benefit wins** | Simple, predictable | Doesn't pick the *best-value* benefit; I'd score/rank if benefits overlap |
| **Same REST contract for Node & Python** | Frontend is backend-agnostic; easy to swap | — |

---

## 8. Known limitations (say these before they're asked)

1. **State is in-memory** — restart wipes claims. Intentional for a demo; real
   version uses a persistent DB.
2. **Global mutable state** (`_counter`, `_registry` in adjudication) is **not
   safe across multiple Uvicorn workers.** With >1 worker, reference numbering
   and status tracking would break. Fix: move to the DB / Redis.
3. **The classifier is a stub**, not a trained model — deterministic keywords.
   The interface is real; the model isn't.
4. **The Lock serializes all DB access** — fine at demo scale, a bottleneck at
   real throughput.
5. **No auth** — single demo card member.
6. **First-match benefit selection** could mis-pick when a txn qualifies for
   multiple benefits.
7. **Stubs are canned** — flight status, receipts, and adjudication are
   deterministic fixtures.

Owning these makes you look senior. Each one has a one-line "here's the real fix."

---

## 9. The two signature questions

**Q: Do you auto-approve claims?**
No. Covered detects, matches, and pre-fills. A claim's status **only ever changes
inside `stubs/adjudication.py`**, which represents the separate, unchanged claims
system. `claims_layer` hands off and reads back — it never decides.

**Q: Does adding a new benefit type mean a rebuild?**
No. Every limit, window, MCC list, and exclusion lives in
`seed_data/entitlements.json`. `rules_engine` reads them generically (it loops
`entitlements["benefits"]`). Adding a benefit = appending one JSON object; the
engine, API, and debug view pick it up with no code change.

---

## 10. Full interview Q&A bank

### Product / business
- **Who's the customer — the cardholder or the issuer?** Both: cardholder gets
  effortless claims; issuer gets benefit activation → loyalty. It's a B2B2C play
  sold to the issuer.
- **How do you make money / why would Amex want this?** Higher benefit
  utilization increases perceived card value and retention; reduces "I never use
  my benefits" churn. Not a fee product — a loyalty/engagement layer.
- **What's the riskiest assumption?** That we can reliably detect eligibility
  from transaction data alone; edge cases need receipts (hence the e-receipt
  connector, pulled only when needed).
- **Privacy concerns?** We only pull line-item receipts when necessary, not for
  every transaction — minimizing data collection is a deliberate design choice.

### System architecture
- **Walk me through the architecture.** Use §3 + §4.
- **Why separate detection from adjudication?** Compliance and trust: deciding
  payouts is a regulated, liability-bearing function that must stay in the
  system of record. We're an activation layer, not an insurer.
- **Where's the seam for real Kafka?** `stream_emitter._run()` — replace the DB
  poll + timer with a Kafka consumer; `_process_one()` is unchanged.
- **How would this scale to millions of transactions/sec?** Stateless detection
  workers consuming Kafka partitions; rules engine is pure function so it
  horizontally scales; move state to a real DB + cache; adjudication handoff via
  a queue.
- **What's the single point of failure here?** The shared SQLite connection /
  single process. In production the detection layer is stateless and replicated;
  state lives in HA datastores.

### Rules engine & detection
- **Why rules before ML?** Determinism and auditability. Eligibility is a
  policy decision; regulators/benefits-ops must be able to read and version it.
  ML only handles fuzzy categorization and only affects *routing*.
- **What happens when a txn matches multiple benefits?** Currently first-eligible
  wins (benefit order in JSON). I'd improve this by scoring candidates (e.g.
  highest coverage, member's best outcome) — a known limitation.
- **How is the trace used?** Every benefit's pass/fail reasons are stored in
  `trace_json` and surfaced in the debug view — that's the "prove the rules"
  transparency.
- **What if the entitlements JSON is malformed?** Today it'd throw at load; in
  production you'd validate against a schema (pydantic/JSON Schema) on publish and
  version the rule packs.

### ML classifier
- **Is there real ML here?** No — it's a deterministic stub behind a `predict()`
  interface. The point is the *integration seam*: a trained model slots in with
  no caller changes.
- **How would you train the real one?** Labelled transaction history (merchant,
  MCC, amount, memo → category); a gradient-boosted or simple text classifier;
  serve behind an endpoint returning class + probability.
- **Why does confidence matter?** It routes: high → auto-draft, low → ask the
  member to confirm. It never decides eligibility.
- **What confidence threshold and why 0.7?** `HIGH_CONFIDENCE = 0.7` — a tunable
  chosen so ambiguous marketplaces (0.45) fall to confirm while branded merchants
  (0.9+) auto-draft. In production you'd tune it against a precision/recall target
  and probably make it per-benefit.

### Data layer / SQLite
- **Why SQLite?** Zero-setup, deterministic, single-file — perfect for a
  prototype. It stands in for MySQL + DynamoDB/Redis + warehouse.
- **Why in-memory?** Clean, reproducible state on every boot for demos.
- **How do you handle concurrent access?** One shared connection with
  `check_same_thread=False`, all access serialized through a `Lock` in `query()`.
- **What breaks that at scale?** The lock serializes everything. Production: a
  real DB with a connection pool; reads from a cache/replica.

### Concurrency / Python internals
- **FastAPI is async — are your handlers async?** Mostly sync; Uvicorn runs sync
  handlers in a threadpool. The stream is a separate daemon thread. That
  multi-threading is exactly why the DB needs the lock.
- **Why a daemon thread for the stream?** So it dies with the process and doesn't
  block shutdown; it's a background producer, not request-scoped.
- **GIL concerns?** The workload is I/O-light and lock-serialized, so the GIL
  isn't the bottleneck at demo scale. Real throughput comes from horizontal
  scaling of stateless workers, not threads.
- **Could you have used asyncio instead of a thread?** Yes —
  `asyncio.create_task` with `await asyncio.sleep(1.5)`. I used a thread because
  the DB calls are synchronous `sqlite3`; mixing sync DB in an async loop would
  block the event loop unless offloaded.

### Stubs & integration
- **What's real vs stubbed?** Engine logic and claims flow are real; the stream,
  entitlements source, flight API, receipts, and adjudicator are stubs. Each stub
  file documents exactly what it replaces and what changes to make it real.
- **How does the flight gate work?** For travel benefits, `detection_engine`
  calls `get_flight_status()`; unless delayed ≥ threshold or cancelled, the txn is
  dropped — proving we check reality, not just the charge (see the on-time
  American Airlines case).
- **How does status advance?** `get_adjudication_status()` computes status from
  `time.time() - submitted_at`. Pull-based, no timers.

### API design
- **List the endpoints.** `/transactions`, `/transactions/stream/start|stop|status`,
  `/coverages`, `/claims/{id}/draft`, `POST /claims`, `/claims/{ref}/status`,
  `/benefits`, `/debug/evaluations`, `/health`.
- **Why 409 on a blocked claim?** It's a conflict with existing state
  (duplicate/refund/warranty) — semantically a 409, and the frontend branches on
  it to show the block reason.
- **REST vs the frontend contract?** Identical across Node and Python backends,
  so the React app is backend-agnostic (Vite proxies `/api` → `:4000`).

### Security & fraud
- **How do you prevent abuse?** `duplicate_check` blocks double-filing, already-
  refunded items, and warranty double-dips before anything hits the adjudicator.
- **What fraud vectors remain?** Fabricated "what happened" narratives, photo
  tampering, collusion — real adjudication + a proper fraud service (velocity,
  device, merchant-refund cross-checks) handle those; our stub is a placeholder.
- **PII handling?** Minimal collection (receipts on-demand), no card PAN (only
  last-4), no auth in the prototype but that's a stated gap.

### Testing & verification
- **How do you know it works?** `verify.py` prints every transaction's routing +
  the abuse-guard results with no UI — deterministic, checkable. The debug
  endpoint exposes the per-txn trace.
- **How would you add automated tests?** Unit tests on `rules_engine`
  (table-driven per benefit), `classifier`, `duplicate_check`; API tests with
  `TestClient`; a golden-file test asserting the 15/3/6 routing split.

### Tradeoffs / reflection
- **What would you do differently with more time?** Persist state, replace the
  classifier stub with a trained model, event-driven adjudication, benefit
  scoring for multi-match, schema-validate the rule packs, auth, and real tests.
- **Hardest part?** Getting the detection/adjudication boundary clean and making
  the rules genuinely config-driven (no hidden hardcoding) — that's what makes
  the two signature answers true.
- **Why port to Python if Node already worked?** To show the architecture is
  language-agnostic and the REST contract is a stable seam; and Python is the
  natural home once the classifier becomes a real ML model.

### Behavioral / team
- **Who did what?** (Fill in honestly.) Be ready to explain *your* contribution
  precisely and to answer detail questions on any file — you should be able to,
  after this doc.
- **How did you split the work?** Backend engine / frontend / data+stubs is a
  clean 3-way split.
- **What did you cut and why?** Auth, persistence, real ML — scoped out to land a
  convincing end-to-end demo in hackathon time.

---

## 11. Rapid-fire technical answers

- **Language/stack?** Python, FastAPI, Uvicorn, SQLite (`sqlite3`), std-lib only.
- **How many transactions seeded?** 24. Routing: 15 eligible, 3 quick-confirm, 6 dropped.
- **What's the hero case?** MacBook Air, $1,199, capped to $1,000 (per-item limit).
- **Coverage window / deadline?** Purchase-date + `coverage_window_days` /
  `filing_deadline_days` from the JSON (90d for purchase protection).
- **How is the payout cap computed?** `min(amount, per_item_limit)`.
- **Confidence threshold?** 0.7 (`HIGH_CONFIDENCE`).
- **Where does status change?** Only in `stubs/adjudication.py`.
- **Reference format?** `{PP|RP|TD}-{counter}`, counter starts at 4820.
- **How does the frontend get live updates?** Polling every ~1.2–1.5s (no
  WebSockets — deliberately simple).
- **What does the flight gate check?** delayed ≥ threshold hours OR cancelled.
- **What port?** Backend 4000, frontend 5173.

---

## 12. If they ask you to extend it live

Be ready to *show* the config-driven claim by adding a benefit:

1. Open `seed_data/entitlements.json`.
2. Append a benefit object, e.g. **cell-phone protection**:
   ```json
   {
     "benefit_type": "cellphone_protection",
     "display_name": "Cell Phone Protection",
     "eligible_card_products": ["Platinum", "Gold"],
     "eligible_mcc_codes": ["4812", "4814"],
     "excluded_categories": ["cash_equivalents"],
     "min_amount": 0,
     "per_item_limit": 800,
     "annual_limit": 1600,
     "coverage_window_days": 90,
     "filing_deadline_days": 60
   }
   ```
3. Restart the backend. Add a matching transaction (MCC 4812) and it routes to the
   new benefit — **zero engine code changed.** That's the scalability story, live.

Other quick extensions you could speak to:
- Add a rule field (e.g. `max_claims_per_year`) → one check in `_evaluate_benefit`.
- Swap `predict()` for a real model → no caller changes.
- Replace the adjudication stub with an HTTP client → the claims layer is unchanged.

---

*Study tip: the single most convincing thing you can do is trace `txn_1001` (or
the on-time flight `txn_1203`) through every file from memory. If you can do that
and answer the two signature questions, you can hold the whole interview.*
