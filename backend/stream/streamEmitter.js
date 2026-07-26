/**
 * stream/streamEmitter.js
 * ---------------------------------------------------------------------------
 * Mock transaction stream.
 *
 * STANDS IN FOR: Kafka / Amazon MSK carrying the live authorization feed.
 * Here it is an in-process EventEmitter that walks the seeded transactions and
 * emits them one at a time on a timer, so the UI can show transactions
 * "arriving live" and being detected in real time.
 *
 * WHAT WOULD CHANGE TO MAKE IT REAL: replace the timer + DB walk with a real
 * Kafka consumer; the per-event handling (evaluate -> persist -> emit) is
 * unchanged.
 * ---------------------------------------------------------------------------
 */

import { EventEmitter } from "events";
import db, { entitlements } from "../db.js";
import { evaluateTransaction } from "../engine/detectionEngine.js";

class TransactionStream extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.intervalMs = 1500;
    this.running = false;
  }

  isRunning() {
    return this.running;
  }

  /** Evaluate ONE transaction through the Detection Engine and persist it. */
  processOne(txnRow) {
    const raw = JSON.parse(txnRow.raw_json);
    const result = evaluateTransaction(raw, entitlements);

    db.prepare(`
      UPDATE transactions
         SET status = ?, benefit_type = ?, coverage_json = ?, confidence = ?, trace_json = ?
       WHERE transaction_id = ?
    `).run(
      result.status,
      result.benefit_type,
      result.coverage ? JSON.stringify(result.coverage) : null,
      result.confidence,
      JSON.stringify(result.trace),
      txnRow.transaction_id
    );

    const event = {
      transaction_id: txnRow.transaction_id,
      merchant: txnRow.merchant,
      amount: txnRow.amount,
      status: result.status,
      benefit_type: result.benefit_type,
      coverage: result.coverage,
      confidence: result.confidence
    };
    this.emit("evaluated", event);

    // Console line so stage 4 (rules visibly filtering) is checkable in the log.
    const tag =
      result.status === "eligible" ? "✅ COVERED   " :
      result.status === "quick_confirm" ? "❔ CONFIRM?   " :
      "⛔ DROP      ";
    console.log(
      `[stream] ${tag} ${txnRow.transaction_id.padEnd(9)} ${String(txnRow.merchant).padEnd(20)} ` +
      `$${String(txnRow.amount).padEnd(9)} -> ${result.status}` +
      (result.benefit_type ? ` (${result.benefit_type})` : "")
    );
    return event;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.emit("started");

    const tick = () => {
      // Pull the next un-evaluated transaction (status 'new'), oldest-emitted first.
      const next = db
        .prepare("SELECT * FROM transactions WHERE status = 'new' ORDER BY timestamp DESC LIMIT 1")
        .get();

      if (!next) {
        this.stop();
        this.emit("drained");
        return;
      }
      this.processOne(next);
    };

    this.timer = setInterval(tick, this.intervalMs);
    tick(); // emit the first one immediately
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.emit("stopped");
  }

  /** Evaluate ALL pending transactions immediately (used by verify + fast demo). */
  drainNow() {
    let n = 0;
    let next;
    while ((next = db.prepare("SELECT * FROM transactions WHERE status = 'new' ORDER BY timestamp DESC LIMIT 1").get())) {
      this.processOne(next);
      n++;
    }
    return n;
  }
}

const stream = new TransactionStream();
export default stream;
