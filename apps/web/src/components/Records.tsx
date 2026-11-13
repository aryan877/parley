import { Link } from "react-router-dom";
import { useRecords } from "../lib/chronicle.ts";
import { useLiveArena } from "../lib/live.ts";
import { fmtNear } from "../lib/model.ts";
import { Mascot } from "./Mascot.tsx";
import "./Records.css";

interface Tile {
  label: string;
  faces: string[];
  line: string;
  sub: string;
  to: string;
}

/** The arena's standing records, read from the contract's matches and coins. */
export function RecordsStrip() {
  const records = useRecords();
  const { coins } = useLiveArena(10_000);
  if (!records || !records.matches) return null;
  const name = (id: string) => coins?.find((c) => c.id === id)?.name ?? id.toUpperCase();
  const { betrayal, streak, richest, improved } = records;
  const tiles: Tile[] = [];
  if (betrayal) {
    tiles.push({
      label: "Biggest betrayal",
      faces: [betrayal.by, betrayal.from],
      line: `${name(betrayal.by)} took ${fmtNear(betrayal.amount)} NEAR from ${name(betrayal.from)}`,
      sub: `Match #${betrayal.match}`,
      to: `/match/${betrayal.match}`,
    });
  }
  if (streak) {
    tiles.push({
      label: "Longest trust streak",
      faces: [streak.a, streak.b],
      line: `${name(streak.a)} and ${name(streak.b)} trusted each other ${streak.length} ${streak.length === 1 ? "time" : "times"} in a row`,
      sub: streak.going ? "Still going" : `Broken after match #${streak.last}`,
      to: `/match/${streak.last}`,
    });
  }
  if (richest) {
    tiles.push({ label: "Richest coin", faces: [richest.coin], line: `${name(richest.coin)} holds ${fmtNear(richest.treasury)} NEAR`, sub: "In its treasury right now", to: `/coin/${richest.coin}` });
  }
  if (improved) {
    const pct = `${Math.abs(improved.pct).toFixed(1)}%`;
    tiles.push({
      label: "Most improved",
      faces: [improved.coin],
      line: improved.pct >= 0 ? `${name(improved.coin)} shares are up ${pct} since launch` : `${name(improved.coin)} shares are down only ${pct} since launch`,
      sub: "Every share started at 1 NEAR",
      to: `/coin/${improved.coin}`,
    });
  }
  if (!tiles.length) return null;
  return (
    <div className="feats">
      <div className="feats-head">
        <b>Records</b>
        <span>{records.scope === "all" ? `From all ${records.matches} matches on chain` : `From the last ${records.matches} matches`}</span>
      </div>
      <div className="feats-row">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className="glass feat">
            <span className="feat-faces">
              {t.faces.map((id) => (
                <Mascot key={id} id={id} size={34} />
              ))}
            </span>
            <span className="feat-text">
              <small>{t.label}</small>
              <b>{t.line}</b>
              <span>{t.sub}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
