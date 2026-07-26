/**
 * stubs/flightStatus.js
 * ---------------------------------------------------------------------------
 * STANDS IN FOR: a real flight-status API (e.g. FlightAware AeroAPI, Cirium).
 *
 * WHAT WOULD CHANGE TO MAKE IT REAL: replace the canned lookup table with an
 * HTTP call to the provider. The exported signature stays identical, so the
 * Detection Engine never has to change:
 *     getFlightStatus(flightNumber, date) -> { status, delayHours }
 * ---------------------------------------------------------------------------
 */

// Canned results keyed by flight number so the demo is deterministic.
const CANNED = {
  DL2245: { status: "delayed", delayHours: 6 },   // qualifies (>= 6h threshold)
  UA980: { status: "cancelled", delayHours: 24 }, // qualifies (cancelled)
  AA1500: { status: "on_time", delayHours: 0 }    // does NOT qualify
};

export function getFlightStatus(flightNumber, date) {
  if (CANNED[flightNumber]) {
    return { flightNumber, date, ...CANNED[flightNumber], source: "stub" };
  }
  // Unknown flight -> pretend it was on time (a real API would return live data).
  return { flightNumber, date, status: "on_time", delayHours: 0, source: "stub" };
}
