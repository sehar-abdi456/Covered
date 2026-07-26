/**
 * detectionEngine.js
 * ---------------------------------------------------------------------------
 * The Detection Engine. Consumes ONE transaction and decides what happens:
 *
 *   1. RULES ENGINE first (deterministic, JSON-configured) -> eligible?
 *   2. ML-STYLE CLASSIFIER STUB for the fuzzy part -> category + confidence.
 *   3. For travel benefits, consult the flight-status stub.
 *   4. Produce a confidence score and ROUTE:
 *        high confidence + eligible  -> "eligible"      (auto-draft a claim)
 *        low  confidence + eligible  -> "quick_confirm" (ask the member 1 tap)
 *        ineligible                  -> "ineligible"    (drop silently, no nudge)
 *
 * Covered NEVER decides a claim outcome here — it only detects & matches.
 * ---------------------------------------------------------------------------
 */

import { predict } from "./classifier.js";
import { evaluateEligibility, buildCoverage } from "./rulesEngine.js";
import { getFlightStatus } from "../stubs/flightStatus.js";

// Above this classifier confidence we auto-draft; below it we ask to confirm.
const HIGH_CONFIDENCE = 0.7;

/**
 * evaluateTransaction(transaction, entitlements) -> result
 * result = {
 *   status: 'eligible' | 'quick_confirm' | 'ineligible',
 *   benefit_type, coverage, confidence, classification, trace, flight
 * }
 */
export function evaluateTransaction(transaction, entitlements) {
  // 2) Fuzzy classification (stub for a real ML model).
  const classification = predict(transaction);

  // 1) Deterministic rules against the JSON entitlements.
  const ruling = evaluateEligibility(transaction, entitlements, classification);

  let flight = null;

  // 3) Travel-delay needs the flight-status gate on top of the rules.
  if (ruling.eligible && ruling.benefitType === "travel_delay") {
    flight = getFlightStatus(transaction.flight_number, transaction.flight_date);
    const benefit = entitlements.benefits.find((b) => b.benefit_type === "travel_delay");
    const qualifies =
      flight.status === "cancelled" || flight.delayHours >= benefit.delay_threshold_hours;

    if (!qualifies) {
      return {
        status: "ineligible",
        benefit_type: null,
        coverage: null,
        confidence: classification.confidence,
        classification,
        trace: [
          ...ruling.trace,
          {
            benefit_type: "travel_delay",
            eligible: false,
            reasons: [
              `flight ${flight.flightNumber} status '${flight.status}' (${flight.delayHours}h) ` +
                `below ${benefit.delay_threshold_hours}h threshold`
            ]
          }
        ],
        flight
      };
    }
  }

  // 4) Route on eligibility + confidence.
  if (!ruling.eligible) {
    return {
      status: "ineligible",
      benefit_type: null,
      coverage: null,
      confidence: classification.confidence,
      classification,
      trace: ruling.trace,
      flight
    };
  }

  const status = classification.confidence >= HIGH_CONFIDENCE ? "eligible" : "quick_confirm";

  return {
    status,
    benefit_type: ruling.benefitType,
    coverage: ruling.coverage,
    confidence: classification.confidence,
    classification,
    trace: ruling.trace,
    flight
  };
}

export { buildCoverage };
