/**
 * api.js — the ONLY place the frontend talks to the backend.
 * Every number/date/status rendered in the UI comes from one of these calls;
 * nothing is hardcoded in components.
 */

const BASE = "/api";

async function req(path, opts) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export const api = {
  streamStatus: () => req("/transactions/stream/status").then((r) => r.body),
  startStream: () => req("/transactions/stream/start", { method: "POST" }).then((r) => r.body),
  stopStream: () => req("/transactions/stream/stop", { method: "POST" }).then((r) => r.body),

  transactions: () => req("/transactions").then((r) => r.body),
  coverages: () => req("/coverages").then((r) => r.body),

  draft: (transactionId) => req(`/claims/${transactionId}/draft`).then((r) => r.body),
  submitClaim: (payload) =>
    req("/claims", { method: "POST", body: JSON.stringify(payload) }),
  claimStatus: (reference) => req(`/claims/${reference}/status`).then((r) => r.body),

  benefits: () => req("/benefits").then((r) => r.body),
  evaluations: () => req("/debug/evaluations").then((r) => r.body)
};
