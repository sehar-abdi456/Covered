"""
engine/detection_engine.py
---------------------------------------------------------------------------
The Detection Engine. Consumes ONE transaction and decides what happens:

  1. RULES ENGINE first (deterministic, JSON-configured) -> eligible?
  2. ML-STYLE CLASSIFIER STUB for the fuzzy part -> category + confidence.
  3. For travel benefits, consult the flight-status stub.
  4. Produce a confidence score and ROUTE:
       high confidence + eligible  -> "eligible"      (auto-draft a claim)
       low  confidence + eligible  -> "quick_confirm" (ask the member 1 tap)
       ineligible                  -> "ineligible"    (drop silently, no nudge)

Covered NEVER decides a claim outcome here -- it only detects & matches.
---------------------------------------------------------------------------
"""

from engine.classifier import predict
from engine.rules_engine import evaluate_eligibility
from stubs.flight_status import get_flight_status

# Above this classifier confidence we auto-draft; below it we ask to confirm.
HIGH_CONFIDENCE = 0.7


def evaluate_transaction(transaction, entitlements):
    """evaluate_transaction(transaction, entitlements) -> result dict:
    {status, benefit_type, coverage, confidence, classification, trace, flight}
    status in {"eligible", "quick_confirm", "ineligible"}
    """
    # 2) Fuzzy classification (stub for a real ML model).
    classification = predict(transaction)

    # 1) Deterministic rules against the JSON entitlements.
    ruling = evaluate_eligibility(transaction, entitlements, classification)

    flight = None

    # 3) Travel-delay needs the flight-status gate on top of the rules.
    if ruling["eligible"] and ruling["benefit_type"] == "travel_delay":
        flight = get_flight_status(transaction.get("flight_number"), transaction.get("flight_date"))
        benefit = next(b for b in entitlements["benefits"] if b["benefit_type"] == "travel_delay")
        qualifies = flight["status"] == "cancelled" or flight["delayHours"] >= benefit["delay_threshold_hours"]

        if not qualifies:
            return {
                "status": "ineligible",
                "benefit_type": None,
                "coverage": None,
                "confidence": classification["confidence"],
                "classification": classification,
                "trace": ruling["trace"] + [{
                    "benefit_type": "travel_delay",
                    "eligible": False,
                    "reasons": [
                        f"flight {flight['flightNumber']} status '{flight['status']}' "
                        f"({flight['delayHours']}h) below {benefit['delay_threshold_hours']}h threshold"
                    ],
                }],
                "flight": flight,
            }

    # 4) Route on eligibility + confidence.
    if not ruling["eligible"]:
        return {
            "status": "ineligible",
            "benefit_type": None,
            "coverage": None,
            "confidence": classification["confidence"],
            "classification": classification,
            "trace": ruling["trace"],
            "flight": flight,
        }

    status = "eligible" if classification["confidence"] >= HIGH_CONFIDENCE else "quick_confirm"

    return {
        "status": status,
        "benefit_type": ruling["benefit_type"],
        "coverage": ruling["coverage"],
        "confidence": classification["confidence"],
        "classification": classification,
        "trace": ruling["trace"],
        "flight": flight,
    }
