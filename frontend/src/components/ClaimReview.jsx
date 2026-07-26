/**
 * ClaimReview — the pre-filled claim screen.
 * Read-only fields come straight from GET /claims/:id/draft (pre-fill step).
 * The member edits ONLY "what happened" + a photo placeholder, then submits.
 * After submit we show the reference number and poll the status tracker.
 */
import { useEffect, useState } from "react";
import { api } from "../api.js";

const WHAT_OPTIONS = [
  "Item was damaged",
  "Item was stolen",
  "Merchant refused my return",
  "My trip was delayed",
  "Other"
];

const STAGES = ["submitted", "in_review", "decision"];

function money(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function ClaimReview({ transactionId, onClose, onSubmitted }) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [whatHappened, setWhatHappened] = useState("");
  const [photo, setPhoto] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState(null);
  const [status, setStatus] = useState(null);
  const [blocked, setBlocked] = useState(null);

  useEffect(() => {
    api.draft(transactionId).then((d) => {
      if (d.error) setError(d);
      else setDraft(d);
    });
  }, [transactionId]);

  // Poll claim status after submission -> drives the tracker.
  useEffect(() => {
    if (!reference) return;
    const poll = async () => setStatus(await api.claimStatus(reference));
    poll();
    const t = setInterval(poll, 1500);
    return () => clearInterval(t);
  }, [reference]);

  const submit = async () => {
    setSubmitting(true);
    setBlocked(null);
    const res = await api.submitClaim({
      transaction_id: transactionId,
      what_happened: whatHappened,
      photo_filename: photo
    });
    setSubmitting(false);
    if (res.ok) {
      setReference(res.body.reference);
      onSubmitted?.();
    } else {
      // Duplicate/abuse guard rejected it — show the reason.
      setBlocked(res.body);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        {error && (
          <div className="modal-body">
            <h2>Not eligible</h2>
            <p className="muted">{error.detail || "No matching benefit for this transaction."}</p>
          </div>
        )}

        {!error && !draft && <div className="modal-body">Loading draft…</div>}

        {draft && !reference && (
          <div className="modal-body">
            <h2>File a claim</h2>
            <p className="prefill-tag">✨ Pre-filled by Covered — {draft.benefit_display_name}</p>

            <div className="grid">
              <Field label="Card" value={`${draft.card_product} ····${draft.card_last4}`} />
              <Field label="Merchant" value={draft.merchant} />
              <Field label="Amount" value={money(draft.amount)} />
              <Field label="Purchase date" value={draft.purchase_date} />
              <Field label="Benefit" value={draft.benefit_display_name} />
              <Field label="Coverage limit" value={money(draft.coverage_limit)} />
              <Field label="Filing deadline" value={draft.filing_deadline} />
              <Field label="Days left" value={String(draft.days_left)} />
            </div>

            {draft.flight && (
              <div className="callout">
                Flight {draft.flight.flightNumber}: <strong>{draft.flight.status}</strong>
                {draft.flight.delayHours ? ` (${draft.flight.delayHours}h delay)` : ""}
              </div>
            )}
            {draft.requires_confirmation && (
              <div className="callout warn">
                This purchase was low-confidence — please confirm the details below before filing.
              </div>
            )}

            <div className="editable">
              <label>What happened?</label>
              <select value={whatHappened} onChange={(e) => setWhatHappened(e.target.value)}>
                <option value="">Select…</option>
                {WHAT_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>

              <label>Add a photo</label>
              <input
                type="file"
                onChange={(e) => setPhoto(e.target.files?.[0]?.name || "photo.jpg")}
              />
              {photo && <span className="photo-name">Attached: {photo}</span>}
            </div>

            {blocked && (
              <div className="blocked">
                <strong>Can’t file this claim</strong>
                <div className="blocked-code">{blocked.code}</div>
                <p>{blocked.reason}</p>
              </div>
            )}

            <button
              className="submit-btn"
              disabled={!whatHappened || submitting}
              onClick={submit}
            >
              {submitting ? "Submitting…" : "Submit claim"}
            </button>
          </div>
        )}

        {reference && (
          <div className="modal-body">
            <h2>Claim submitted</h2>
            <div className="ref">Reference <strong>{reference}</strong></div>
            <Tracker status={status?.status} decision={status?.decision} />
            <p className="muted small">
              Covered handed this to the claims system. Adjudication happens there —
              Covered never approves a claim.
            </p>
            <button className="submit-btn" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <input className="field-input" value={value} readOnly disabled />
    </div>
  );
}

function Tracker({ status, decision }) {
  const idx = STAGES.indexOf(status);
  const labels = { submitted: "Submitted", in_review: "In review", decision: "Decision" };
  return (
    <div className="tracker">
      {STAGES.map((s, i) => (
        <div key={s} className={`step ${i <= idx ? "done" : ""} ${i === idx ? "current" : ""}`}>
          <div className="dot" />
          <div className="step-label">
            {labels[s]}
            {s === "decision" && decision && <div className="decision">{decision}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
