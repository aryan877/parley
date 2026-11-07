import { Link, useParams } from "react-router-dom";
import { Loading, MatchRow } from "../components/bits.tsx";
import { TreasuryChart } from "../components/charts.tsx";
import { near, signedNear, useLeague } from "../lib/data.ts";

export function CoinPage() {
  const { id } = useParams();
  const { league, error } = useLeague();
  if (!league) return <Loading error={error} />;
  const coin = league.manifest.coins.find((c) => c.id === id);
  const standing = league.stats.standings.find((s) => s.id === id);
  if (!coin || !standing) return <p className="sub">No such coin in this recording.</p>;
  const matches = league.evidence.map((e, i) => ({ e, i })).filter(({ e }) => e.parley.a === id || e.parley.b === id);

  return (
    <>
      <div className="crumbs">
        <Link to="/">League</Link> / {coin.name}
      </div>
      <h1 className="title">{coin.name}</h1>
      <p className="sub">
        <span className="tag">{coin.house ? "House coin: no holders, constitution fixed forever" : "Holder-governed"}</span>{" "}
        <span className="tag">constitution v{coin.constitution_version}</span> <span className="tag">{coin.model}</span>{" "}
        {coin.token && <span className="tag">NEP-141: {coin.token}</span>}
      </p>

      <div className="card pad">
        <p className="constitution">{coin.constitution}</p>
      </div>

      <section className="stats" style={{ marginTop: 14 }}>
        <div className="card pad stat">
          <b>{near(coin.treasury)}</b>
          <span>NEAR in the treasury ({signedNear(standing.change)})</span>
        </div>
        <div className="card pad stat">
          <b>{Math.round(standing.cooperationRate * 100)}%</b>
          <span>of its {standing.played} moves were cooperate</span>
        </div>
        <div className="card pad stat">
          <b>{standing.betrayals}</b>
          <span>times it betrayed a cooperating coin</span>
        </div>
        <div className="card pad stat">
          <b>{standing.betrayed}</b>
          <span>times it was betrayed</span>
        </div>
      </section>

      <section>
        <h2>Treasury</h2>
        <div className="card pad">
          <TreasuryChart league={league} focus={coin.id} />
        </div>
      </section>

      <section>
        <h2>Its Parleys</h2>
        <div className="card feed" style={{ padding: 6 }}>
          {matches.reverse().map(({ i }) => (
            <MatchRow key={i} league={league} index={i} />
          ))}
        </div>
      </section>
    </>
  );
}
