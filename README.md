# Covered — Backend (FastAPI)

The backend for Covered: a FastAPI service that detects eligible card benefits on
a live transaction stream, pre-fills claims, and hands them off to a (stubbed)
adjudication system. It serves its REST API on **port 4000**, which is what the
<<<<<<< HEAD
React frontend in [`../frontend`](../frontend) proxies to — so the frontend runs
=======
React frontend in [`../frontend`](frontend) proxies to — so the frontend runs
>>>>>>> 50caacd (updated README)
against it unchanged.

`verify.py` exercises the full pipeline over the seeded data and reports the
routing outcome: 15 eligible, 3 quick-confirm, 6 dropped, and all 3 abuse cases
blocked.

## Run it

```bash
cd backend-python
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python main.py            # http://localhost:4000  (or: uvicorn main:app --port 4000)
```

Then, in another terminal, start the frontend:

```bash
cd ../frontend
npm install
npm run dev               # http://localhost:5173  (proxies /api -> :4000)
```

### Engine proof with no UI

```bash
python verify.py          # prints every transaction's routing decision + the
                          # duplicate/abuse results to the console
```

## Structure

```
backend-python/
├── main.py                     # FastAPI app + all endpoints
├── db.py                       # SQLite data layer (thread-safe shared conn)
├── verify.py                   # console-verifiable pipeline proof
├── requirements.txt
├── seed_data/
│   ├── entitlements.json        # machine-readable T&Cs — the RULE PACK
│   └── transactions.json        # 24 seeded transactions
├── engine/
│   ├── rules_engine.py          # deterministic, JSON-configured eligibility
│   ├── classifier.py            # ML-style classifier STUB (predict → {category, confidence})
│   └── detection_engine.py      # rules + classifier + confidence routing
├── claims/
│   ├── claims_layer.py           # drafts, submit, track status
│   └── duplicate_check.py        # duplicate/abuse guard
├── stream/
│   └── stream_emitter.py         # mock "Kafka" feed (background thread)
└── stubs/
    ├── flight_status.py          # flight-status API stub
    ├── e_receipt.py             # e-receipt / line-item connector stub
    └── adjudication.py           # Amex claims/adjudication black-box stub
```

## Endpoints

`GET /transactions` · `POST /transactions/stream/start|stop` ·
`GET /transactions/stream/status` · `GET /coverages` ·
`GET /claims/{transaction_id}/draft` · `POST /claims` ·
`GET /claims/{reference}/status` · `GET /benefits` ·
`GET /debug/evaluations` · `GET /health`

## Tech

FastAPI + Uvicorn, SQLite (`sqlite3`, in-memory, shared thread-safe connection),
a background-thread stream emitter (Kafka stand-in), a JSON-driven rules engine,
and a pluggable `predict()` classifier interface where a real scikit-learn model
<<<<<<< HEAD
would slot in. Standard library everywhere else — no ORM, no extra infra.
=======
would slot in. Standard library everywhere else — no ORM, no extra infra.
>>>>>>> 50caacd (updated README)
