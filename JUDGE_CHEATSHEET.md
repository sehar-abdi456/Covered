# Judge Cheat Sheet

The two questions a technical judge asks — and exactly where the code answers
them.

---

## Q1. "Do you auto-approve claims?"

**No. Covered only detects, matches, and pre-fills. It never adjudicates.**

Where this is proven in the code:

- A claim's status **only ever changes inside the adjudication stub**, which
  stands in for the real (separate) Amex claims system:
  - [`backend/stubs/adjudication.js`](backend/stubs/adjudication.js) —
    `getAdjudicationStatus()` is the single source of a claim's status.
- The Claims Layer **hands off** to that system and reads status back — it does
  not decide anything:
  - [`backend/claims/claimsLayer.js`](backend/claims/claimsLayer.js) —
    `submitClaim()` calls `submitToAdjudicator()`; `getClaimStatus()` mirrors the
    downstream status.
- The Detection Engine produces a **routing decision** (eligible / quick-confirm
  / drop) — never an *approval*:
  - [`backend/engine/detectionEngine.js`](backend/engine/detectionEngine.js).
- The member-facing screen says it out loud: *"Covered handed this to the claims
  system. Adjudication happens there — Covered never approves a claim."*
  - [`frontend/src/components/ClaimReview.jsx`](frontend/src/components/ClaimReview.jsx).

---

## Q2. "Does adding a new benefit type mean a rebuild?"

**No. A new benefit is a new entry in the entitlements JSON — not a code
change.**

Where this is proven in the code:

- Every limit, window, MCC list, exclusion, and threshold lives in the config
  pack, not in logic:
  - [`backend/seed-data/entitlements.json`](backend/seed-data/entitlements.json).
- The rules engine **reads those values generically** — it loops over
  `entitlements.benefits` and never hardcodes a benefit's numbers:
  - [`backend/engine/rulesEngine.js`](backend/engine/rulesEngine.js) —
    `evaluateEligibility()` / `evaluateBenefit()` / `buildCoverage()`.

**Live proof:** to add, say, a "cell phone protection" benefit, you would append
one object to `entitlements.json` (its MCCs, per-item limit, window, deadline).
No engine code changes. The **Engine (debug)** tab and `GET /debug/evaluations`
would immediately start routing matching transactions to it.

> Try it: add a benefit object to `entitlements.json`, restart the backend, and
> watch new coverages appear — zero code edits.

---

## One-liner for each acceptance criterion

| Criterion | Where |
|---|---|
| Boots with seed data, no manual entry | `backend/db.js` (`seed()`), loads on import |
| Live feed pushes txns, cards appear w/o refresh | `stream/streamEmitter.js` + `frontend/App.jsx` polling |
| Full journey (detect → pre-fill → submit → track) | `LiveFeed.jsx` → `ClaimReview.jsx` → Benefits tab |
| Rules reject ineligible / route ambiguous | `detectionEngine.js`; visible in **Engine (debug)** tab |
| Duplicate/abuse blocked with clear error | `claims/duplicateCheck.js`; shown in `ClaimReview.jsx` |
| Every UI number comes from the backend | `frontend/src/api.js` is the only data source |
