/**
 * DebugView — the admin/engine view that PROVES the rules engine works:
 * every transaction, its routing decision, confidence, and the per-benefit
 * reasoning trace. Satisfies acceptance criterion #4 (rules visibly filtering).
 */
import { Fragment, useEffect, useState } from "react";
import { api } from "../api.js";

const STATUS_META = {
  eligible: { label: "ELIGIBLE", cls: "ok" },
  quick_confirm: { label: "QUICK CONFIRM", cls: "warn" },
  claimed: { label: "CLAIMED", cls: "ok" },
  ineligible: { label: "DROPPED", cls: "bad" },
  new: { label: "PENDING", cls: "muted" }
};

export default function DebugView() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    const load = () => api.evaluations().then(setRows);
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="debug">
      <p className="muted small">
        Live view of the Detection Engine deciding each transaction. Click a row for the
        rule-by-rule trace. Nothing here is hardcoded — it reflects the rules in{" "}
        <code>entitlements.json</code>.
      </p>
      <table className="debug-table">
        <thead>
          <tr>
            <th>Txn</th><th>Merchant</th><th>MCC</th><th>Amount</th><th>Conf.</th><th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const meta = STATUS_META[r.status] || STATUS_META.new;
            return (
              <Fragment key={r.transaction_id}>
                <tr onClick={() => setOpen(open === r.transaction_id ? null : r.transaction_id)} className="debug-row">
                  <td>{r.transaction_id}</td>
                  <td>{r.merchant}</td>
                  <td>{r.mcc}</td>
                  <td>${r.amount}</td>
                  <td>{r.confidence != null ? r.confidence.toFixed(2) : "—"}</td>
                  <td><span className={`chip ${meta.cls}`}>{meta.label}</span></td>
                </tr>
                {open === r.transaction_id && (
                  <tr className="trace-row">
                    <td colSpan={6}>
                      {r.demo_note && <div className="demo-note">📝 {r.demo_note}</div>}
                      {r.trace ? (
                        <ul className="trace">
                          {r.trace.map((t, i) => (
                            <li key={i} className={t.eligible ? "t-ok" : "t-bad"}>
                              <strong>{t.benefit_type}</strong>: {t.reasons.join("; ")}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="muted">Not evaluated yet — start the feed.</span>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
