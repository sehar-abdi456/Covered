/**
 * verify.js — console-verifiable proof of the pipeline (build stages 2-5).
 * Run: npm run verify
 * Evaluates every seeded transaction and prints the routing decision + the
 * duplicate/abuse guard results, so you can confirm the engine works WITHOUT
 * the frontend.
 */

import db, { entitlements } from "./db.js";
import stream from "./stream/streamEmitter.js";
import { checkDuplicateOrAbuse } from "./claims/duplicateCheck.js";

console.log("\n=== 1) DETECTION ENGINE: evaluate every seeded transaction ===\n");
stream.drainNow();

const rows = db.prepare("SELECT * FROM transactions ORDER BY timestamp DESC").all();
const buckets = { eligible: [], quick_confirm: [], ineligible: [], claimed: [] };
for (const r of rows) (buckets[r.status] ||= []).push(r);

const line = (r) =>
  `  ${r.transaction_id.padEnd(9)} ${String(r.merchant).padEnd(20)} mcc:${String(r.mcc).padEnd(5)} ` +
  `$${String(r.amount).padEnd(9)} conf:${(r.confidence ?? 0).toFixed(2)}` +
  (r.benefit_type ? `  -> ${r.benefit_type}` : "");

console.log(`ELIGIBLE (auto-draft)  [${buckets.eligible.length}]`);
buckets.eligible.forEach((r) => console.log(line(r)));
console.log(`\nQUICK_CONFIRM (low confidence)  [${buckets.quick_confirm.length}]`);
buckets.quick_confirm.forEach((r) => console.log(line(r)));
console.log(`\nINELIGIBLE (dropped silently)  [${buckets.ineligible.length}]`);
buckets.ineligible.forEach((r) => console.log(line(r)));

console.log("\n=== 2) DUPLICATE / ABUSE GUARD on the seeded abuse cases ===\n");
for (const id of ["txn_1501", "txn_1502", "txn_1503", "txn_1001"]) {
  const txn = db.prepare("SELECT * FROM transactions WHERE transaction_id = ?").get(id);
  const guard = checkDuplicateOrAbuse(db, txn);
  console.log(
    `  ${id}  ${guard.blocked ? "BLOCKED" : "ok"}` +
      (guard.blocked ? `  [${guard.code}] ${guard.reason}` : "")
  );
}

console.log("\n=== 3) HERO CASE draft (txn_1001) ===\n");
const { buildDraft } = await import("./claims/claimsLayer.js");
console.log(JSON.stringify(buildDraft("txn_1001"), null, 2));

console.log("\nDone.\n");
process.exit(0);
