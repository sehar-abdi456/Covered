/**
 * Benefits tab — active/detected coverages and every claim's live status,
 * all pulled from GET /benefits.
 */
import { useEffect, useState } from "react";
import { api } from "../api.js";

function money(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

const STATUS_LABEL = {
  submitted: "Submitted",
  in_review: "In review",
  decision: "Decision",
  claimed: "Claimed"
};

export default function Benefits() {
  const [data, setData] = useState(null);

  useEffect(() => {
    const load = () => api.benefits().then(setData);
    load();
    const t = setInterval(load, 1500); // keep claim statuses fresh
    return () => clearInterval(t);
  }, []);

  if (!data) return <div className="empty">Loading…</div>;

  return (
    <div className="benefits">
      <section>
        <h3>Your claims</h3>
        {data.claims.length === 0 && <p className="muted">No claims filed yet.</p>}
        <div className="claim-list">
          {data.claims.map((c) => (
            <div key={c.reference} className="claim-row">
              <div className="claim-ref">{c.reference}</div>
              <div className="claim-mid">
                <div className="claim-benefit">{c.benefit_type?.replaceAll("_", " ")}</div>
                <div className="muted small">{c.what_happened || "—"} · {c.transaction_id}</div>
              </div>
              <div className={`claim-status ${c.status}`}>
                {STATUS_LABEL[c.status] || c.status}
                {c.decision && <span className="claim-decision"> · {c.decision}</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>Detected coverages</h3>
        <div className="claim-list">
          {data.coverages.map((c) => (
            <div key={c.transaction_id} className="claim-row">
              <div className="claim-ref">{c.merchant}</div>
              <div className="claim-mid">
                <div className="claim-benefit">{c.coverage?.display_name || c.benefit_type}</div>
                <div className="muted small">
                  {money(c.amount)} · covered to {money(c.coverage?.coverage_limit)} · file by {c.coverage?.filing_deadline}
                </div>
              </div>
              <div className={`claim-status ${c.status}`}>{STATUS_LABEL[c.status] || c.status}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>Active benefit programs</h3>
        <div className="ent-grid">
          {data.entitlements.map((e) => (
            <div key={e.benefit_type} className="ent-card">
              <div className="ent-name">{e.display_name}</div>
              <div className="muted small">
                Up to {money(e.per_item_limit)} · {e.coverage_window_days}-day window
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
