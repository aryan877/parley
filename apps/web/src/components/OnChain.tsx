import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useArenaInfo } from "../lib/live.ts";
import { BetrayIcon, ChipIcon, ShieldCheckIcon, VoteIcon } from "./icons.tsx";
import { Mascot } from "./Mascot.tsx";

interface Refusal {
  refused: boolean;
  reason: string;
  tx: string;
}

export interface OnChainData {
  deployment: { network: string; rpcUrl: string; contractId: string; deployedAt: string; transactions: Record<string, string> };
  forgeries: { parley: number; triedAt: string; unregisteredKey: Refusal; replayedReply: Refusal } | null;
  amendment: { coin: string; constitution: string; steps: Record<string, string> } | null;
  reask: { decisions: number; timesEach: number; asks: number; flipped: number } | null;
  attestations: { file: string; model: string; publicKey: string }[];
}

const NEARBLOCKS = "https://testnet.nearblocks.io";
const SITE = "https://parley.aryankumar.dev";
export const txUrl = (hash: string) => `${NEARBLOCKS}/txns/${hash}`;
export const addressUrl = (account: string) => `${NEARBLOCKS}/address/${account}`;

let cached: Promise<OnChainData | null> | null = null;
export function loadOnChain(): Promise<OnChainData | null> {
  cached ??= fetch("./data/testnet/onchain.json")
    .then((r) => (r.ok ? (r.json() as Promise<OnChainData>) : null))
    .catch(() => null);
  return cached;
}

type Keys = { count: number; block: number } | "error" | null;

/** Asks NEAR right now how many access keys the contract has. Zero keys means nobody can redeploy it. */
function useAccessKeys(rpcUrl: string | null, account: string | null): Keys {
  const [keys, setKeys] = useState<Keys>(null);
  useEffect(() => {
    if (!rpcUrl || !account) return;
    let live = true;
    fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_access_key_list", finality: "final", account_id: account } }),
    })
      .then((r) => r.json() as Promise<{ result?: { keys: unknown[]; block_height: number } }>)
      .then((body) => live && setKeys(body.result ? { count: body.result.keys.length, block: body.result.block_height } : "error"))
      .catch(() => live && setKeys("error"));
    return () => {
      live = false;
    };
  }, [rpcUrl, account]);
  return keys;
}

const Tx = ({ hash, children }: { hash?: string; children: React.ReactNode }) =>
  hash ? (
    <a className="oc-tx" href={txUrl(hash)} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : null;

const STEPS: [string, string][] = [
  ["propose", "Proposed"],
  ["vote yes", "Voted yes"],
  ["finalize", "Votes counted"],
  ["enact", "In force"],
];

const shortModel = (id: string) => id.split("/").pop() ?? id;
const firstSentences = (text: string, n: number) => (text.match(/[^.!?]+[.!?]+/g) ?? [text]).slice(0, n).join("").trim();

/** What the public testnet deployment has already proven, with a live check that the contract is locked. */
export function OnChain() {
  const { info } = useArenaInfo();
  const [data, setData] = useState<OnChainData | null>(null);
  useEffect(() => {
    loadOnChain().then(setData);
  }, []);
  const dep = data?.deployment ?? null;
  const rpc = dep ? (info && info.contractId === dep.contractId ? info.rpcUrl : dep.rpcUrl) : null;
  const keys = useAccessKeys(rpc, dep?.contractId ?? null);
  if (!data || !dep) return null;
  const { forgeries, amendment, reask } = data;
  const t = dep.transactions;
  const coin = amendment?.coin.toUpperCase() ?? "";
  const onTestnet = info?.contractId === dep.contractId;
  const after = (
    <>
      <Mascot id="saint" size={30} mood="betray" />
      <span>Then in match 12, {coin} refused to trust SNAKE</span>
    </>
  );

  return (
    <section className="onchain">
      <div className="section-head">
        <div>
          <h2 style={{ fontSize: 32 }}>On chain right now</h2>
          <p>The live arena on NEAR testnet. Every line links to the real transaction.</p>
        </div>
      </div>

      <motion.div className="oc-lock" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <span className={`g-tile big ${keys === null || keys === "error" || keys.count === 0 ? "trust" : "betray"}`}>
          <ShieldCheckIcon size={32} />
        </span>
        <div className="oc-lock-text">
          <a className="oc-account" href={addressUrl(dep.contractId)} target="_blank" rel="noreferrer">
            {dep.contractId}
          </a>
          <h3>
            {keys === null
              ? "Asking NEAR how many keys it has…"
              : keys === "error"
                ? "Could not reach NEAR just now. Try the link."
                : keys.count === 0
                  ? "0 access keys, code can never change"
                  : `${keys.count} access ${keys.count === 1 ? "key" : "keys"}. Its code can still change`}
          </h3>
          <p className="faint small">
            {keys && keys !== "error" ? `Your browser asked NEAR just now, at block ${keys.block.toLocaleString("en-US")}.` : "Checked live from your browser."}
            {keys && keys !== "error" && keys.count === 0 && " Nobody holds a key to it, us included."}
          </p>
          <div className="oc-links">
            <Tx hash={t.deploy}>Deployed</Tx>
            <Tx hash={t.init}>Started</Tx>
            <Tx hash={t.lock}>Locked for good</Tx>
            {data.attestations.map((a) => (
              <a key={a.file} className="oc-tx soft" href={`./data/testnet/${a.file}`} target="_blank" rel="noreferrer" title={a.publicKey}>
                <ChipIcon size={14} /> Intel report for {shortModel(a.model)}
              </a>
            ))}
          </div>
        </div>
      </motion.div>

      <div className="oc-grid">
        {forgeries && (
          <div className="oc-card">
            <div className="oc-head">
              <span className="g-tile betray">
                <BetrayIcon size={20} />
              </span>
              <h3>Two fake replies, both refused</h3>
            </div>
            <div className="oc-refusal">
              <b>A reply signed with a key the contract never saw</b>
              <code>{forgeries.unregisteredKey.reason}</code>
              <Tx hash={forgeries.unregisteredKey.tx}>See the refusal</Tx>
            </div>
            <div className="oc-refusal">
              <b>A real reply, copied onto a different question</b>
              <code>{forgeries.replayedReply.reason}</code>
              <Tx hash={forgeries.replayedReply.tx}>See the refusal</Tx>
            </div>
          </div>
        )}

        {amendment && (
          <div className="oc-card">
            <div className="oc-head">
              <span className="g-tile trust">
                <VoteIcon size={20} />
              </span>
              <h3>{coin}'s holders changed its rules</h3>
            </div>
            <p className="oc-quote">“{firstSentences(amendment.constitution, 2)}”</p>
            <div className="oc-steps">
              {STEPS.map(([key, label]) => (
                <Tx key={key} hash={amendment.steps[key]}>
                  {label}
                </Tx>
              ))}
            </div>
            {onTestnet ? (
              <Link to="/match/12" className="oc-next">
                {after}
              </Link>
            ) : (
              <a href={`${SITE}/#/match/12`} className="oc-next" target="_blank" rel="noreferrer">
                {after}
              </a>
            )}
          </div>
        )}

        {reask && (
          <div className="oc-card">
            <div className="oc-head">
              <span className="g-tile mind">
                <ChipIcon size={20} />
              </span>
              <h3>Same question, same answer</h3>
            </div>
            <p className="oc-number">
              <b>{reask.flipped}</b> of {reask.asks}
            </p>
            <p className="muted small">
              re-asks changed a move. We asked all {reask.decisions} Season 1 choices {reask.timesEach === 2 ? "twice" : `${reask.timesEach} times`} more{reask.flipped === 0 ? ", and every answer came back the same." : "."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
