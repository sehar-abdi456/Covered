/**
 * LiveFeed — shows "Covered" cards appearing as the engine detects eligible
 * purchases. Every value (amount, cap, days-left) comes from the API payload.
 */
export default function LiveFeed({ coverages, onFile }) {
  if (!coverages.length) {
    return (
      <div className="empty">
        <p>No coverage detected yet.</p>
        <p className="muted">Click <strong>Start transaction feed</strong> above — cards appear as purchases are detected.</p>
      </div>
    );
  }

  return (
    <div className="feed">
      {coverages.map((c) => (
        <CoverageCard key={c.transaction_id} c={c} onFile={onFile} />
      ))}
    </div>
  );
}

function money(n, ccy = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: ccy }).format(n);
}

function CoverageCard({ c, onFile }) {
  const cov = c.coverage || {};
  const confirm = c.status === "quick_confirm";
  const claimed = c.status === "claimed";

  return (
    <div className={`cov-card ${confirm ? "confirm" : ""} ${claimed ? "claimed" : ""}`}>
      <div className="cov-head">
        <div className="cov-merchant">{c.merchant}</div>
        <div className="cov-amount">{money(c.amount, c.currency)}</div>
      </div>

      <div className="cov-benefit">{cov.display_name || c.benefit_type}</div>

      <div className="cov-facts">
        <div>
          <span className="label">Covered up to</span>
          <span className="val">{money(cov.coverage_limit)}</span>
        </div>
        <div>
          <span className="label">File by</span>
          <span className="val">{cov.filing_deadline}</span>
        </div>
        <div>
          <span className="label">Days left</span>
          <span className="val">{cov.days_left}</span>
        </div>
      </div>

      {c.demo_note && <div className="cov-note">{c.demo_note}</div>}

      <div className="cov-foot">
        {claimed ? (
          <span className="filed-tag">✓ Claim filed</span>
        ) : confirm ? (
          <button className="file-btn confirm" onClick={() => onFile(c.transaction_id)}>
            Quick confirm &amp; file
          </button>
        ) : (
          <button className="file-btn" onClick={() => onFile(c.transaction_id)}>
            Tap if something went wrong
          </button>
        )}
        {confirm && <span className="conf-pill">Low confidence · needs 1 tap</span>}
      </div>
    </div>
  );
}
