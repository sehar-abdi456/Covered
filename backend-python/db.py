"""
db.py -- Data Layer
---------------------------------------------------------------------------
SQLite (single in-memory database, zero-setup) STANDS IN FOR the production
combo of MySQL (system-of-record) + DynamoDB/Redis (fast reads) + a warehouse.

Logical stores:
  - entitlements : per-benefit coverage rules (loaded from entitlements.json;
                   mirrored into a table so the "data layer" is real, but the
                   Rules Engine still reads the JSON config pack directly).
  - transactions : the seeded feed + an evaluation `status` per row.
  - claims       : submitted claims + status + reference number.

A single shared connection (check_same_thread=False) is guarded by a lock so the
background stream thread and the API request threads can share it safely.
---------------------------------------------------------------------------
"""

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

SEED_DIR = Path(__file__).parent / "seed_data"

# Entitlements are the config pack -- the source of truth for the Rules Engine.
ENTITLEMENTS = json.loads((SEED_DIR / "entitlements.json").read_text())

_conn = sqlite3.connect(":memory:", check_same_thread=False)
_conn.row_factory = sqlite3.Row
_lock = threading.Lock()


def query(sql, params=(), *, one=False, write=False):
    """Thread-safe helper. Returns rows (as dicts) for reads, lastrowid for writes."""
    with _lock:
        cur = _conn.execute(sql, params)
        if write:
            _conn.commit()
            return cur.lastrowid
        rows = cur.fetchall()
    if one:
        return dict(rows[0]) if rows else None
    return [dict(r) for r in rows]


def _init_schema():
    _conn.executescript(
        """
        CREATE TABLE entitlements (
            benefit_type TEXT PRIMARY KEY,
            config_json  TEXT NOT NULL
        );
        CREATE TABLE transactions (
            transaction_id TEXT PRIMARY KEY,
            card_last4     TEXT,
            card_product   TEXT,
            merchant       TEXT,
            mcc            TEXT,
            amount         REAL,
            currency       TEXT,
            timestamp      TEXT,
            category_hint  TEXT,
            flight_number  TEXT,
            flight_date    TEXT,
            flags_json     TEXT,
            raw_json       TEXT,
            -- new | eligible | quick_confirm | ineligible | claimed
            status         TEXT DEFAULT 'new',
            benefit_type   TEXT,
            coverage_json  TEXT,
            confidence     REAL,
            trace_json     TEXT
        );
        CREATE TABLE claims (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            reference      TEXT UNIQUE,
            transaction_id TEXT NOT NULL,
            benefit_type   TEXT,
            draft_json     TEXT,
            what_happened  TEXT,
            photo_filename TEXT,
            status         TEXT DEFAULT 'submitted',
            decision       TEXT,
            created_at     TEXT
        );
        """
    )
    _conn.commit()


def _seed():
    # Mirror entitlements into the table.
    for b in ENTITLEMENTS["benefits"]:
        _conn.execute(
            "INSERT INTO entitlements (benefit_type, config_json) VALUES (?, ?)",
            (b["benefit_type"], json.dumps(b)),
        )

    # Load the seeded transaction feed. Rows start as 'new' -- the stream emitter
    # + detection engine will evaluate them one at a time during the demo.
    txns = json.loads((SEED_DIR / "transactions.json").read_text())
    for t in txns:
        _conn.execute(
            """
            INSERT INTO transactions
              (transaction_id, card_last4, card_product, merchant, mcc, amount, currency,
               timestamp, category_hint, flight_number, flight_date, flags_json, raw_json, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
            """,
            (
                t["transaction_id"], t["card_last4"], t["card_product"], t["merchant"],
                str(t["mcc"]), t["amount"], t["currency"], t["timestamp"],
                t.get("category_hint"), t.get("flight_number"), t.get("flight_date"),
                json.dumps(t["flags"]) if t.get("flags") else None, json.dumps(t),
            ),
        )

    # Pre-seed ONE claim so the duplicate stub has something to reject in the demo
    # (txn_1501). See claims/duplicate_check.py.
    _conn.execute(
        """
        INSERT INTO claims (reference, transaction_id, benefit_type, draft_json, what_happened, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "PP-4820", "txn_1501", "purchase_protection",
            json.dumps({"note": "pre-seeded claim for duplicate demo"}),
            "Screen cracked", "in_review", datetime.now(timezone.utc).isoformat(),
        ),
    )
    _conn.commit()


_init_schema()
_seed()
