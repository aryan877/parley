import type { Coin } from "@parley/sdk/src/types.ts";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { type RulesVersion, useRulesHistory } from "../lib/chronicle.ts";
import { type ArenaInfo, loadLiveMatch, txLink } from "../lib/live.ts";
import { type Match, coinName, fmtNear } from "../lib/model.ts";
import { chainDate } from "../lib/time.ts";
import { headline } from "../lib/words.ts";
import { ArrowIcon } from "./icons.tsx";
import { Mascot } from "./Mascot.tsx";
import "./SaintStory.css";

const MATCH = 12;

function Rule({ v, label, link, linkText }: { v: RulesVersion; label: string; link: string | null; linkText: string }) {
  return (
    <div className={`saint-rule ${v.version > 1 ? "after" : ""}`}>
      <small>{label}</small>
      <p>“{v.constitution}”</p>
      <span className="saint-meta">
        {v.yes !== null && v.no !== null ? `Passed with ${fmtNear(v.yes)} shares for and ${BigInt(v.no) > 0n ? fmtNear(v.no) : "none"} against` : "Launched"}
        {v.at ? `, ${chainDate(v.at)}` : ""}
        {link && (
          <>
            {" · "}
            <a href={link} target="_blank" rel="noreferrer">
              {linkText}
            </a>
          </>
        )}
      </span>
    </div>
  );
}

/** What one vote already did on chain: SAINT's first rules, the rules its holder voted in, and the match where it refused SNAKE. */
export function SaintStory({ info, saint, coins }: { info: ArenaInfo; saint: Coin; coins: Coin[] }) {
  const { history } = useRulesHistory(saint);
  const [match, setMatch] = useState<Match | null>(null);
  useEffect(() => {
    let live = true;
    loadLiveMatch(info, MATCH).then((m) => live && setMatch(m), () => {});
    return () => {
      live = false;
    };
  }, [info]);
  const [before, after] = [1, 2].map((n) => history?.versions.find((v) => v.version === n));
  const side = match?.a === "saint" ? "A" : match?.b === "saint" ? "B" : null;
  const said = match?.lines.find((l) => l.side === side && l.kind === "Talk");
  const fair = match && side && [match.a, match.b].includes("snake") && (side === "A" ? match.aVersion : match.bVersion) === 2;
  if (!before || !after || !match || !said || !fair) return null;
  const name = coinName(coins);
  const lineLink = txLink(info, said.proof?.txHash);
  return (
    <section className="saint-story">
      <h3>While you wait: what one vote did to SAINT</h3>
      <p className="saint-lead">SAINT's holder, the arena owner, took these same steps on chain. One paragraph changed, and so did how it plays.</p>
      <div className="saint-rules">
        <Rule v={before} label="Version 1" link={txLink(info, before.tx)} linkText="See the launch on NEAR" />
        <Rule v={after} label="Version 2, voted in" link={txLink(info, after.tx)} linkText="See it take effect on NEAR" />
      </div>
      <div className="saint-match">
        <div className="saint-match-top">
          <Mascot id="saint" size={34} />
          <Mascot id="snake" size={34} />
          <b>Then it met SNAKE, in match #{match.id}</b>
        </div>
        <blockquote>“{said.text}”</blockquote>
        <p>{headline(match, name)}</p>
        <div className="judge-actions">
          <Link to={`/match/${match.id}`} className="btn ghost small-btn">
            Watch match #{match.id} <ArrowIcon size={16} />
          </Link>
          {lineLink && (
            <a href={lineLink} target="_blank" rel="noreferrer" className="btn ghost small-btn">
              See SAINT's line on NEAR
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
