"""
stubs/flight_status.py
---------------------------------------------------------------------------
Flight-status lookup used by the travel-delay benefit.

This is now a REAL integration (not just a canned table): if an AviationStack
API key is configured it makes a live HTTP call to a flight-status provider,
with a timeout, an in-memory cache, and error handling. It degrades gracefully
to canned demo data when there's no key or the provider has no record — so the
prototype still runs end-to-end (the seeded demo flights are fictional and
future-dated, so a live API won't have them).

    get_flight_status(flight_number, date) -> {"status", "delayHours", ...}

The public signature is unchanged, so the Detection Engine never has to change
regardless of where the data comes from.

Setup for a live call (optional):
    1. Get a free key at https://aviationstack.com
    2. export AVIATIONSTACK_KEY=your_key_here
Without the key, the canned fallback below is used.
---------------------------------------------------------------------------
"""

import os
import time

import requests

API_KEY = os.environ.get("AVIATIONSTACK_KEY")
API_URL = "http://api.aviationstack.com/v1/flights"
HTTP_TIMEOUT_S = 5          # never let a slow provider hang a request
CACHE_TTL_S = 3600          # remember a flight's status for 1 hour (avoid re-billing)

# Canned results for the seeded demo flights (used as the fallback). Keeps the
# hackathon demo deterministic even with a live key, since these flights are made
# up and dated in the future.
CANNED = {
    "DL2245": {"status": "delayed", "delayHours": 6},    # qualifies (>= 6h threshold)
    "UA980": {"status": "cancelled", "delayHours": 24},  # qualifies (cancelled)
    "AA1500": {"status": "on_time", "delayHours": 0},    # does NOT qualify
}

# Simple in-memory cache: flight_key -> (expires_at, result)
_cache = {}


def _from_cache(key):
    entry = _cache.get(key)
    if entry and entry[0] > time.time():
        return entry[1]
    return None


def _put_cache(key, result):
    _cache[key] = (time.time() + CACHE_TTL_S, result)


def _fallback(flight_number, date):
    """Canned demo data, or on_time for an unknown flight."""
    if flight_number in CANNED:
        return {"flightNumber": flight_number, "date": date, "source": "stub", **CANNED[flight_number]}
    return {"flightNumber": flight_number, "date": date, "status": "on_time", "delayHours": 0, "source": "stub"}


def _call_provider(flight_number, date):
    """Make the real HTTP call and map the provider's response to our shape.
    Returns None if the provider has no record or the call fails — the caller
    then falls back, so an API blip never wrongly denies a claim.
    """
    try:
        resp = requests.get(
            API_URL,
            params={"access_key": API_KEY, "flight_iata": flight_number, "flight_date": date},
            timeout=HTTP_TIMEOUT_S,
        )
        resp.raise_for_status()
        rows = resp.json().get("data") or []
        if not rows:
            return None  # provider has no record for this flight/date

        flight = rows[0]
        # arrival.delay is in MINUTES and may be null.
        delay_minutes = (flight.get("arrival") or {}).get("delay") or 0
        raw_status = (flight.get("flight_status") or "").lower()

        if raw_status == "cancelled":
            status = "cancelled"
        elif delay_minutes >= 60:
            status = "delayed"
        else:
            status = "on_time"

        return {
            "flightNumber": flight_number,
            "date": date,
            "status": status,
            "delayHours": delay_minutes // 60,
            "source": "aviationstack",
        }
    except (requests.RequestException, ValueError, KeyError, IndexError):
        # Timeout, network error, bad JSON, unexpected shape -> let caller fall back.
        return None


def get_flight_status(flight_number, date):
    key = f"{flight_number}:{date}"

    # 1) Fast path: cached result.
    cached = _from_cache(key)
    if cached:
        return cached

    # 2) Live provider call, only if a key is configured.
    result = _call_provider(flight_number, date) if API_KEY else None

    # 3) Graceful fallback to canned/deterministic data.
    if result is None:
        result = _fallback(flight_number, date)

    _put_cache(key, result)
    return result
