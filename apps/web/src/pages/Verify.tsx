import { type Finding, checkLeague } from "@parley/league/src/browser.ts";
import { useState } from "react";
import { Loading } from "../components/bits.tsx";
import { useLeague } from "../lib/data.ts";

export function Verify() {
  const { league, error } = useLeague();
  const [result, setResult] = useState<{ findings: Finding[]; ms: number } | null>(null);
  if (!league) return <Loading error={error} />;
  const turns = league.evidence.reduce((n, e) => n + e.turns.length, 0);

  const run = () => {
    const start = performance.now();
    const findings = checkLeague(league.manifest, league.evidence);
    setResult({ findings, ms: Math.round(performance.now() - start) });
  };

  return (
    <>
      <header className="hero" style={{ paddingBottom: 12 }}>
        <h1>Don't trust the scoreboard.</h1>
        <p>
          This page holds the raw bytes of every request and reply in the league. Press the button and your browser re-checks all {turns} of them. No server
          is asked anything.
        </p>
      </header>

      <button className="btn" onClick={run}>
        Verify {league.evidence.length} Parleys
      </button>

      {result && (
        <div className="card pad" style={{ marginTop: 18 }}>
          <h2 style={{ color: result.findings.length ? "var(--red)" : "var(--green)" }}>
            {result.findings.length ? `${result.findings.length} problems found` : `All ${turns} replies verified`}
          </h2>
          <p className="sub" style={{ margin: 0 }}>
            Checked in {result.ms} ms on this device.
          </p>
          {result.findings.slice(0, 30).map((f, i) => (
            <p key={i} className="note">
              Parley {f.parley}
              {f.turn === undefined ? "" : `, turn ${f.turn}`}: {f.problem}
            </p>
          ))}
        </div>
      )}

      <section>
        <h2>What gets checked</h2>
        <ul className="checks">
          <li>
            <b>Signature.</b> Each reply's Ed25519 signature covers its model, the hash of the request and the hash of the response.
          </li>
          <li>
            <b>Signer.</b> The key is one the contract had registered for that model.
          </li>
          <li>
            <b>Hashes.</b> The request and response hash to the values the chain stored for that turn.
          </li>
          <li>
            <b>Words.</b> The message or move on chain is what the signed response actually says.
          </li>
          <li>
            <b>Nonce.</b> Each request carries its own Parley's nonce, so a reply cannot be reused elsewhere.
          </li>
          <li>
            <b>Money.</b> Each payoff follows the rules, and coins plus commons sums to zero change.
          </li>
        </ul>
        <p className="note">
          From a clone of the repo the same check is one command with no API key: <span style={{ fontFamily: "var(--mono)" }}>bun run verify</span>
        </p>
      </section>
    </>
  );
}
