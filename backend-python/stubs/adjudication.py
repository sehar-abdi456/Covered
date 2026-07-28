"""
stubs/adjudication.py
---------------------------------------------------------------------------
STANDS IN FOR: the real Amex claims / adjudication system -- the "black box" our
Claims Layer submits into. Covered NEVER adjudicates; it only hands a pre-filled
claim to this downstream system.

WHAT IT DOES HERE: an in-memory state machine. On submit it acknowledges and
returns a reference number, then advances the claim's status over time
(submitted -> in_review -> decision) so the UI status tracker has something real
to poll. THIS IS THE ONLY PLACE A CLAIM STATUS CHANGES -- proving Covered does
not auto-approve anything.

WHAT WOULD CHANGE TO MAKE IT REAL: replace this module with a client that POSTs
to the adjudication service and reads back status webhooks/events.
---------------------------------------------------------------------------
"""

import time

# reference -> {"reference", "status", "submitted_at", "decision"}
_registry = {}

# Demo pacing: seconds the mock adjudicator spends before each stage.
IN_REVIEW_AFTER_S = 8      # submitted -> in_review
DECISION_AFTER_S = 20      # submitted -> decision

_PREFIX = {
    "purchase_protection": "PP",
    "return_protection": "RP",
    "travel_delay": "TD",
}

_counter = 4820


def submit_to_adjudicator(claim):
    global _counter
    _counter += 1
    reference = f"{_PREFIX.get(claim['benefit_type'], 'CL')}-{_counter}"
    _registry[reference] = {
        "reference": reference,
        "status": "submitted",
        "submitted_at": time.time(),
        "decision": None,
    }
    return {"reference": reference, "status": "submitted", "acknowledged": True}


def get_adjudication_status(reference):
    """Compute the CURRENT status from elapsed time. Pull-based, so no background
    timers are needed -- status is a pure function of "how long since submit".
    """
    rec = _registry.get(reference)
    if not rec:
        return None

    elapsed = time.time() - rec["submitted_at"]
    status = "submitted"
    decision = None

    if elapsed >= DECISION_AFTER_S:
        status = "decision"
        decision = "approved"  # demo: mock adjudicator approves after review
    elif elapsed >= IN_REVIEW_AFTER_S:
        status = "in_review"

    rec["status"] = status
    rec["decision"] = decision
    return {"reference": reference, "status": status, "decision": decision}


def register_preseeded(reference, benefit_type, status):
    """Seed a claim that already exists (for the duplicate demo) so its status is
    poll-able from the moment the server boots."""
    # Backdate submitted_at so it sits in the requested stage immediately.
    offset = 0
    if status == "in_review":
        offset = IN_REVIEW_AFTER_S + 1
    elif status == "decision":
        offset = DECISION_AFTER_S + 1
    _registry[reference] = {
        "reference": reference,
        "status": status,
        "submitted_at": time.time() - offset,
        "decision": "approved" if status == "decision" else None,
    }
