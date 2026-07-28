"""
stream/stream_emitter.py
---------------------------------------------------------------------------
Mock transaction stream.

STANDS IN FOR: Kafka / Amazon MSK carrying the live authorization feed. Here it
is a background thread that walks the seeded transactions and evaluates them one
at a time on a timer, so the UI can show transactions "arriving live" and being
detected in real time.

WHAT WOULD CHANGE TO MAKE IT REAL: replace the timer + DB walk with a real Kafka
consumer; the per-event handling (evaluate -> persist -> emit) is unchanged.
---------------------------------------------------------------------------
"""

import json
import threading

from db import query, ENTITLEMENTS
from engine.detection_engine import evaluate_transaction


class TransactionStream:
    def __init__(self, interval_s=1.5):
        self.interval_s = interval_s
        self._thread = None
        self._stop = threading.Event()

    def is_running(self):
        return self._thread is not None and self._thread.is_alive()

    def _process_one(self, txn_row):
        """Evaluate ONE transaction through the Detection Engine and persist it."""
        raw = json.loads(txn_row["raw_json"])
        result = evaluate_transaction(raw, ENTITLEMENTS)

        query(
            """
            UPDATE transactions
               SET status = ?, benefit_type = ?, coverage_json = ?, confidence = ?, trace_json = ?
             WHERE transaction_id = ?
            """,
            (
                result["status"], result["benefit_type"],
                json.dumps(result["coverage"]) if result["coverage"] else None,
                result["confidence"], json.dumps(result["trace"]), txn_row["transaction_id"],
            ),
            write=True,
        )

        tag = {
            "eligible": "COVERED  ",
            "quick_confirm": "CONFIRM? ",
        }.get(result["status"], "DROP     ")
        bt = f" ({result['benefit_type']})" if result["benefit_type"] else ""
        print(f"[stream] {tag} {txn_row['transaction_id']:<9} {str(txn_row['merchant']):<20} "
              f"${str(txn_row['amount']):<9} -> {result['status']}{bt}")
        return result

    def _next_new(self):
        return query(
            "SELECT * FROM transactions WHERE status = 'new' ORDER BY timestamp DESC LIMIT 1",
            one=True,
        )

    def _run(self):
        # Emit the first one immediately, then on the interval.
        while not self._stop.is_set():
            nxt = self._next_new()
            if not nxt:
                break
            self._process_one(nxt)
            self._stop.wait(self.interval_s)

    def start(self):
        if self.is_running():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def drain_now(self):
        """Evaluate ALL pending transactions immediately (used by verify + fast demo)."""
        n = 0
        while True:
            nxt = self._next_new()
            if not nxt:
                break
            self._process_one(nxt)
            n += 1
        return n


stream = TransactionStream()
