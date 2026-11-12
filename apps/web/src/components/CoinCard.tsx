import { Link } from "react-router-dom";
import { type CoinInfo, fmtNear, nearNumber, pctText, sharePrice, sinceLaunch, trustRate } from "../lib/model.ts";
import { tagline } from "../lib/words.ts";
import { Mascot, mascotColor } from "./Mascot.tsx";
import { RulesPill } from "./RulesPill.tsx";

export function Sparkline({ values, width = 120, height = 34, color, fluid = false }: { values: number[]; width?: number; height?: number; color: string; fluid?: boolean }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - 3 - ((v - min) / Math.max(1e-9, max - min)) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const id = `g${color.replace("#", "")}${values.length}`;
  return (
    <svg width={fluid ? "100%" : width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function CoinCard({ coin, rank, history, start, curve, to, price }: { coin: CoinInfo; rank?: number; history: ("t" | "b")[]; start: string; curve?: number[]; to: string; price?: boolean }) {
  const pct = (price ? sinceLaunch(coin) : null) ?? (nearNumber(BigInt(coin.treasury) - BigInt(start)) / nearNumber(start)) * 100;
  const color = mascotColor(coin.id);
  return (
    <Link to={to} className="coin-card" style={{ "--c": color } as React.CSSProperties}>
      {rank !== undefined && <span className="rank">#{rank}</span>}
      <div className="top">
        <Mascot id={coin.id} size={64} mood={pct > 0 ? "win" : pct < 0 ? "lose" : "idle"} />
        <div>
          <h3 className="title-line">
            {coin.name}
            <RulesPill version={coin.version} />
          </h3>
          <div className="tag">{tagline(coin.id, coin.rules)}</div>
        </div>
      </div>
      <div className="row">
        <div>
          <div className="price">{price ? `${sharePrice(coin).toFixed(3)}` : fmtNear(coin.treasury)}</div>
          <div className="faint" style={{ fontSize: 11.5 }}>{price ? "NEAR per share" : "NEAR in its treasury"}</div>
          <div className={`change ${pct >= 0 ? "up" : "down"}`}>
            {pctText(pct)} <span className="since">since launch</span>
          </div>
        </div>
        {curve && <Sparkline values={curve} color={color} />}
      </div>
      <div className="card-foot">
        <div className="trust-bar" title={`Trusted in ${Math.round(trustRate(coin) * 100)}% of its moves`}>
          <i style={{ width: `${trustRate(coin) * 100}%` }} />
        </div>
        <div className="mini">
          <span>
            <b className="up">{coin.trusted}</b> trusted · <b className="down">{coin.betrayed}</b> betrayed
          </span>
          <span>{history.length ? `last: ${history.at(-1) === "t" ? "Trust" : "Betray"}` : "no matches yet"}</span>
        </div>
      </div>
    </Link>
  );
}
