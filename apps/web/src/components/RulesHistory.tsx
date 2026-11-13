import type { Coin } from "@parley/sdk/src/types.ts";
import { Fragment, useState } from "react";
import { type RulesVersion, useRulesHistory, wordDiff } from "../lib/chronicle.ts";
import { txLink, useArenaInfo } from "../lib/live.ts";
import { fmtNear } from "../lib/model.ts";
import { chainDate } from "../lib/time.ts";
import { shortAccount, useWallet } from "../lib/wallet.tsx";
import "./RulesHistory.css";

const FOLD_AT = 24;
const KEEP = 8;

function Diff({ before, after }: { before?: string; after: string }) {
  const [open, setOpen] = useState(false);
  const parts = before === undefined ? [{ kind: "same" as const, text: after }] : wordDiff(before, after);
  const changed = parts.some((p) => p.kind !== "same");
  return (
    <p className="rh-text">
      {parts.map((p, i) => {
        const gap = i ? " " : "";
        if (p.kind === "added") return <Fragment key={i}>{gap}<ins>{p.text}</ins></Fragment>;
        if (p.kind === "removed") return <Fragment key={i}>{gap}<del>{p.text}</del></Fragment>;
        const words = p.text.split(" ");
        if (open || !changed || words.length <= FOLD_AT) return <Fragment key={i}>{gap}{p.text}</Fragment>;
        const head = i === 0 ? "" : `${words.slice(0, KEEP).join(" ")} `;
        const tail = i === parts.length - 1 ? "" : ` ${words.slice(-KEEP).join(" ")}`;
        return (
          <Fragment key={i}>
            {gap}
            {head}
            <button className="rh-fold" onClick={() => setOpen(true)} aria-label="Show the words that did not change">
              …
            </button>
            {tail}
          </Fragment>
        );
      })}
    </p>
  );
}

function Version({ v, prev, current, who, link }: { v: RulesVersion; prev?: RulesVersion; current: boolean; who: (account: string) => string; link: string | null }) {
  const when = v.at ? chainDate(v.at) : null;
  const meta = [
    v.version === 1 ? `Launched${when ? ` ${when}` : ""}` : when ? `Took effect ${when}` : "Voted in by its holders",
    v.by && `${v.version === 1 ? "by" : "proposed by"} ${who(v.by)}`,
    prev && prev.model !== v.model && `its AI changed to ${v.model.split("/").pop()}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className={`glass rh-version ${current ? "now" : ""}`}>
      <div className="rh-top">
        <b>Version {v.version}</b>
        {current && <span className="rh-now">In force now</span>}
      </div>
      <p className="rh-meta">{meta}</p>
      <Diff before={v.version === 1 ? undefined : prev?.constitution} after={v.constitution} />
      {(v.yes !== null || link) && (
        <div className="rh-foot">
          {v.yes !== null && v.no !== null && (
            <span>
              Passed with <b className="up">{fmtNear(v.yes)}</b> shares for and <b className={BigInt(v.no) > 0n ? "down" : ""}>{fmtNear(v.no)}</b> against.
            </span>
          )}
          {link && (
            <a className="rh-link" href={link} target="_blank" rel="noreferrer">
              {v.version === 1 ? "See the launch on NEAR" : "See it take effect on NEAR"}
            </a>
          )}
        </div>
      )}
    </article>
  );
}

/** Every version of a coin's rules, newest first, each with what changed from the one before. */
export function RulesHistory({ coin }: { coin: Coin }) {
  const { info } = useArenaInfo();
  const w = useWallet();
  const { history, loading } = useRulesHistory(coin);
  const who = (account: string) => (account === w.accountId ? "you" : account === info?.overview.owner ? "the arena owner" : shortAccount(account).replace(/…$/, ""));

  if (coin.constitution_version <= 1) {
    return (
      <section className="rh" id="rules-history">
        <h2 className="part-title">Its rules over time</h2>
        <p className="rh-still">
          Still on the rules it launched with, {chainDate(coin.created_at)}. When holders vote in new rules, each version shows up here with what changed.
        </p>
      </section>
    );
  }

  const versions = history?.versions ?? [];
  const byVersion = new Map(versions.map((v) => [v.version, v]));
  const shown = versions.length ? [...versions].reverse() : [];
  return (
    <section className="rh" id="rules-history">
      <h2 className="part-title">Its rules over time</h2>
      <p className="rh-lead">
        {coin.constitution_version} versions, newest first. <ins>Green</ins> words were added, <del>crossed-out</del> words were removed.
      </p>
      <div className="rh-list">
        {shown.map((v) => (
          <Version key={v.version} v={v} prev={byVersion.get(v.version - 1)} current={v.version === coin.constitution_version} who={who} link={txLink(info, v.tx)} />
        ))}
        {!shown.length && <p className="muted loading-line">{loading ? "Reading its rules history from the chain…" : "Its rules history could not be read right now."}</p>}
        {shown.length > 0 && !history?.complete && (
          <p className="faint small rh-wait">{loading ? "Reading older versions from the chain…" : "Some older versions could not be read right now."}</p>
        )}
      </div>
    </section>
  );
}
