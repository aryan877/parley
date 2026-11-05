import type { League } from "../lib/data.ts";
import { nameOf } from "./bits.tsx";

const PALETTE = ["#3dbe8b", "#ef5a4c", "#e8b84a", "#6ea8fe", "#c792ea", "#f78c6c", "#7fdbca", "#98a2b3"];

export function TreasuryChart({ league, focus }: { league: League; focus?: string }) {
  const series = Object.entries(league.stats.treasuryByParley).map(([id, points]) => ({
    id,
    values: points.map((p) => Number(BigInt(p) / 10n ** 20n) / 10_000),
  }));
  const all = series.flatMap((s) => s.values);
  const [min, max] = [Math.min(...all), Math.max(...all)];
  const n = series[0]?.values.length ?? 1;
  const [w, h, padL, padR, padY] = [1000, 300, 44, 96, 18];
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (w - padL - padR);
  const y = (v: number) => padY + (1 - (v - min) / Math.max(1e-9, max - min)) * (h - 2 * padY);
  const ticks = [min, (min + max) / 2, max];
  const labels = series
    .map((s) => ({ id: s.id, at: y(s.values.at(-1)!) + 4 }))
    .sort((p, q) => p.at - q.at);
  for (let i = 1; i < labels.length; i++) labels[i]!.at = Math.max(labels[i]!.at, labels[i - 1]!.at + 14);
  const overflow = Math.max(0, (labels.at(-1)?.at ?? 0) - (h - 2));
  for (const label of labels) label.at -= overflow;
  const labelAt = new Map(labels.map((l) => [l.id, l.at]));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", display: "block" }} role="img" aria-label="Treasury of each coin after every Parley">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="#262d39" />
          <text x={padL - 8} y={y(t) + 4} textAnchor="end" fill="#6b7585" fontSize="12" fontFamily="var(--mono)">
            {t.toFixed(0)}
          </text>
        </g>
      ))}
      {series.map((s, i) => {
        const dim = focus && focus !== s.id;
        const color = PALETTE[i % PALETTE.length];
        return (
          <g key={s.id} opacity={dim ? 0.18 : 1}>
            <polyline fill="none" stroke={color} strokeWidth={focus === s.id ? 3 : 1.8} points={s.values.map((v, j) => `${x(j)},${y(v)}`).join(" ")} />
            <text x={w - padR + 8} y={labelAt.get(s.id)} fill={color} fontSize="12">
              {nameOf(league, s.id)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Heatmap({ league }: { league: League }) {
  const ids = league.stats.standings.map((s) => s.id);
  const shade = (rate: number) => `color-mix(in srgb, #3dbe8b ${Math.round(rate * 100)}%, #ef5a4c)`;
  return (
    <table className="heat">
      <thead>
        <tr>
          <th />
          {ids.map((id) => (
            <th key={id}>{nameOf(league, id).slice(0, 5)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ids.map((me) => (
          <tr key={me}>
            <th style={{ textAlign: "right" }}>{nameOf(league, me)}</th>
            {ids.map((them) => {
              const cell = league.stats.matrix[me]?.[them];
              if (me === them || !cell) return <td key={them} />;
              const rate = cell.cooperated / cell.played;
              return (
                <td key={them} className="cell" style={{ background: shade(rate) }} title={`${nameOf(league, me)} cooperated with ${nameOf(league, them)} in ${cell.cooperated} of ${cell.played}`}>
                  {cell.cooperated}/{cell.played}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function OutcomeSplit({ league }: { league: League }) {
  const o = league.stats.outcomes;
  const parts = [
    { label: "Both cooperated", n: o.bothCooperate, color: "#3dbe8b" },
    { label: "One betrayed the other", n: o.oneDefects, color: "#e8b84a" },
    { label: "Both defected", n: o.bothDefect, color: "#ef5a4c" },
  ];
  return (
    <>
      <div className="split">
        {parts.map((p) => (
          <i key={p.label} style={{ flex: p.n, background: p.color }} />
        ))}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} />
            {p.label}: {p.n}
          </span>
        ))}
      </div>
    </>
  );
}
