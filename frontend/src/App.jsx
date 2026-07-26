import { useEffect, useState, useCallback } from "react";
import { api } from "./api.js";
import LiveFeed from "./components/LiveFeed.jsx";
import ClaimReview from "./components/ClaimReview.jsx";
import Benefits from "./components/Benefits.jsx";
import DebugView from "./components/DebugView.jsx";

export default function App() {
  const [tab, setTab] = useState("feed");
  const [stream, setStream] = useState({ running: false, pending: 0 });
  const [coverages, setCoverages] = useState([]);
  const [activeTxn, setActiveTxn] = useState(null); // transaction_id under claim review

  // Poll the backend so new "Covered" cards appear without a page refresh.
  const refresh = useCallback(async () => {
    const [s, cov] = await Promise.all([api.streamStatus(), api.coverages()]);
    setStream(s);
    setCoverages(cov);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1200);
    return () => clearInterval(t);
  }, [refresh]);

  const toggleStream = async () => {
    if (stream.running) await api.stopStream();
    else await api.startStream();
    refresh();
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <div>
            <div className="brand-name">Covered</div>
            <div className="brand-tag">You already paid for the coverage. We file the claim for you.</div>
          </div>
        </div>
        <button className={`stream-btn ${stream.running ? "on" : ""}`} onClick={toggleStream}>
          {stream.running ? "■ Stop feed" : "▶ Start transaction feed"}
          <span className="pending">{stream.pending} pending</span>
        </button>
      </header>

      <nav className="tabs">
        <button className={tab === "feed" ? "active" : ""} onClick={() => setTab("feed")}>
          Live feed <span className="badge">{coverages.length}</span>
        </button>
        <button className={tab === "benefits" ? "active" : ""} onClick={() => setTab("benefits")}>
          Benefits
        </button>
        <button className={tab === "debug" ? "active" : ""} onClick={() => setTab("debug")}>
          Engine (debug)
        </button>
      </nav>

      <main className="content">
        {tab === "feed" && (
          <LiveFeed coverages={coverages} onFile={(txnId) => setActiveTxn(txnId)} />
        )}
        {tab === "benefits" && <Benefits />}
        {tab === "debug" && <DebugView />}
      </main>

      {activeTxn && (
        <ClaimReview
          transactionId={activeTxn}
          onClose={() => setActiveTxn(null)}
          onSubmitted={() => {
            refresh();
          }}
        />
      )}
    </div>
  );
}
