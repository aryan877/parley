import { attestedKeys, checkLeague, type Finding } from "@parley/league/src/browser.ts";
import { motion } from "motion/react";
import { useState } from "react";
import { CoinIcon, PotIcon, ShieldCheckIcon } from "../components/icons.tsx";
import { useSeason } from "../lib/season.ts";

const short = (hex: string) => `${hex.slice(0, 10)}…${hex.slice(-6)}`;

export function ProofPage() {
  const season = useSeason();
  const [result, setResult] = useState<{ findings: Finding[]; ms: number } | null>(null);
  const [running, setRunning] = useState(false);
  if (!season) return <p className="muted">Loading…</p>;
  const { league } = season;
  const replies = season.matches.reduce((n, m) => n + m.lines.length, 0);
  const keys = attestedKeys(league.manifest);

  const run = () => {
    setRunning(true);
    setTimeout(() => {
      const start = performance.now();
      const findings = checkLeague(league.manifest, league.evidence, league.attestations);
      setResult({ findings, ms: Math.max(1, Math.round(performance.now() - start)) });
      setRunning(false);
    }, 50);
  };

  return (
    <>
      <div className="page-head" style={{ textAlign: "center", display: "grid", justifyItems: "center" }}>
        <h1>Don't trust us. Check.</h1>
        <p className="muted">
          This page holds the raw bytes of every question and every answer in Season 1. Press the button and your own browser re-checks all {replies} of them. No server is
          asked anything.
        </p>
        <div style={{ marginTop: 24 }}>
          <button className="btn big trust" onClick={run} disabled={running}>
            <ShieldCheckIcon /> {running ? "Checking…" : `Check all ${replies} replies`}
          </button>
        </div>
      </div>

      {result && (
        <motion.div className={`verdict-big ${result.findings.length ? "bad" : "ok"}`} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
          <ShieldCheckIcon size={54} />
          <div>
            <h2>{result.findings.length ? `${result.findings.length} problems found` : `All ${replies} replies are genuine`}</h2>
            <p>
              Checked on this device in {result.ms} ms. {keys ? `${keys} hardware keys traced to Intel's root certificate.` : "This recording used a stand-in key, not sealed hardware."}
            </p>
            {result.findings.slice(0, 12).map((f, i) => (
              <p key={i} className="small">
                {f.parley !== undefined && `Match ${f.parley}: `}
                {f.problem}
              </p>
            ))}
          </div>
        </motion.div>
      )}

      <section style={{ marginTop: 56 }}>
        <div className="steps3">
          {[
            ["The chain writes the question", "The contract builds every prompt itself, from the coin's rules, both records and the chat so far. Nobody in between can change a word."],
            ["Sealed hardware stamps the answer", "Each model runs inside an Intel TDX enclave at NEAR AI Cloud. Its key never leaves the chip, and it signs the exact question and the exact answer together."],
            ["The contract checks the stamp", "Before a turn counts or any money moves, the contract checks the signature against a key it registered for that model. A faked or edited reply is refused."],
          ].map(([title, text], i) => (
            <div key={title} className="glass step-card">
              <div className="art" style={{ height: 60, justifyContent: "flex-start", color: ["var(--gold)", "var(--mind)", "var(--trust)"][i] }}>
                {[<CoinIcon key="c" size={44} />, <ShieldCheckIcon key="s" size={44} />, <PotIcon key="p" size={44} />][i]}
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2 style={{ fontSize: 32 }}>The hardware keys</h2>
            <p>Every reply in Season 1 was signed by one of these. The contract stores each key with the hash of its Intel quote, and the quote itself is recorded here.</p>
          </div>
        </div>
        <div className="match-list">
          {league.manifest.models.flatMap((m) =>
            m.signers.map((s) => {
              const quote = league.attestations.find((a) => a.model === m.id && a.publicKey === s.public_key);
              return (
                <div key={s.public_key} className="match-row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <span>
                    <b>{m.id}</b>
                    <br />
                    <span className="faint small">{quote ? `Intel TDX quote, made for "${quote.nonceText}"` : "Local stand-in key, not sealed hardware"}</span>
                  </span>
                  <code>{short(s.public_key)}</code>
                </div>
              );
            }),
          )}
        </div>
        <p className="muted small" style={{ marginTop: 16 }}>
          From a copy of the code, the same check is one command with no API key: <code>bun run verify</code>. What this does and does not prove is written down in docs/LIMITS.md.
        </p>
      </section>
    </>
  );
}
