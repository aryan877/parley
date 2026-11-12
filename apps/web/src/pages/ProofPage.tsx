import { attestedKeys, checkLeague, type Finding } from "@parley/league/src/browser.ts";
import { motion } from "motion/react";
import { useState } from "react";
import { ProofGuide } from "../components/Guide.tsx";
import { AskIcon, ChipIcon, ShieldCheckIcon } from "../components/icons.tsx";
import { accountLink, networkName, useArenaInfo } from "../lib/live.ts";
import { useSeason } from "../lib/season.ts";

const short = (hex: string) => `${hex.slice(0, 10)}…${hex.slice(-6)}`;

export function ProofPage() {
  const season = useSeason();
  const { info } = useArenaInfo();
  const [result, setResult] = useState<{ findings: Finding[]; ms: number } | null>(null);
  const [running, setRunning] = useState(false);
  if (!season) return <p className="muted loading-line">Loading…</p>;
  const { league } = season;
  const replies = season.matches.reduce((n, m) => n + m.lines.length, 0);
  const keys = attestedKeys(league.manifest);

  const run = () => {
    setRunning(true);
    setTimeout(() => {
      const start = performance.now();
      const findings = checkLeague(league.manifest, league.evidence, league.attestations, league.stats);
      setResult({ findings, ms: Math.max(1, Math.round(performance.now() - start)) });
      setRunning(false);
    }, 50);
  };

  return (
    <>
      <div className="page-head compact" style={{ textAlign: "center", display: "grid", justifyItems: "center" }}>
        <h1>Don't trust us. Check.</h1>
        <p className="muted">
          Every Season 1 question and answer is saved on this page.
          <br />
          Press the button and your own browser re-checks all {replies} signatures. No server is asked.
        </p>
      </div>
      <ProofGuide />
      <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
        <motion.button className="btn big trust" onClick={run} disabled={running} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
          <ShieldCheckIcon /> {running ? "Checking…" : `Check all ${replies} replies`}
        </motion.button>
      </div>

      {result && (
        <motion.div className={`verdict-big ${result.findings.length ? "bad" : "ok"}`} initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 16 }}>
          <ShieldCheckIcon size={54} />
          <div>
            <h2>{result.findings.length ? `${result.findings.length} problems found` : `All ${replies} replies are genuine`}</h2>
            <p>
              Checked on this device in {result.ms} ms. {keys ? `${keys} hardware keys traced to Intel's root certificate.` : "This recording used a practice key, not sealed hardware."}
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
        <div className="section-head">
          <div>
            <h2 style={{ fontSize: 32 }}>Each step, in more detail</h2>
          </div>
        </div>
        <div className="steps3">
          {[
            ["The chain writes the question", "The contract builds every prompt itself, from the coin's rules, both records and the chat so far. Nobody in between can change a word."],
            ["Sealed hardware signs the answer", "Each model runs inside Intel TDX sealed hardware at NEAR AI Cloud. It signs the exact question and the exact answer together."],
            ["The contract checks the stamp", "Before a turn counts or any money moves, the contract checks the signature against the key it registered for that model. It refuses any reply that is not signed."],
          ].map(([title, text], i) => (
            <motion.div key={title} className="glass step-card" whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 380, damping: 22 }}>
              <div className={`g-tile ${["gold", "mind", "trust"][i]} big`}>{[<AskIcon key="a" size={30} />, <ChipIcon key="c" size={30} />, <ShieldCheckIcon key="s" size={32} />][i]}</div>
              <h3>{title}</h3>
              <p>{text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2 style={{ fontSize: 32 }}>The hardware keys</h2>
            <p>Every Season 1 reply was signed by one of these keys. The contract stores each key with a hash of its Intel report, and the report itself is saved here.</p>
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
                    <span className="faint small">{quote ? `Intel TDX report, made for "${quote.nonceText}"` : "Local practice key, not sealed hardware"}</span>
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
        {info && (
          <p className="muted small contract-line">
            The live arena runs on {networkName(info)}. Its contract is{" "}
            {accountLink(info, info.contractId) ? (
              <a href={accountLink(info, info.contractId)!} target="_blank" rel="noreferrer">
                {info.contractId}, see it on NEAR
              </a>
            ) : (
              <code>{info.contractId}</code>
            )}
            .
          </p>
        )}
      </section>
    </>
  );
}
