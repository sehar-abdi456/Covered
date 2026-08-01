"""
stubs/flight_status.py
---------------------------------------------------------------------------
STANDS IN FOR: a real flight-status API (e.g. FlightAware AeroAPI, Cirium).

WHAT WOULD CHANGE TO MAKE IT REAL: replace the canned lookup table with an HTTP
call to the provider. The function signature stays identical so the Detection
Engine never has to change:
    get_flight_status(flight_number, date) -> {"status", "delayHours"}
---------------------------------------------------------------------------
"""

# Canned results keyed by flight number so the demo is deterministic.
CANNED = {
    "DL2245": {"status": "delayed", "delayHours": 6},    # qualifies (>= 6h threshold)
    "UA980": {"status": "cancelled", "delayHours": 24},  # qualifies (cancelled)
    "AA1500": {"status": "on_time", "delayHours": 0},    # does NOT qualify
}


def get_flight_status(flight_number, date):
    if flight_number in CANNED:
        return {"flightNumber": flight_number, "date": date, "source": "stub", **CANNED[flight_number]}
    # Unknown flight -> pretend it was on time (a real API would return live data).
    return {"flightNumber": flight_number, "date": date, "status": "on_time", "delayHours": 0, "source": "stub"}
