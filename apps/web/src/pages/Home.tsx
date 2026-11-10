import { thoughts } from "@parley/league/src/browser.ts";
import { Link } from "react-router-dom";
import { Loading, MatchRow } from "../components/bits.tsx";
import { Heatmap, OutcomeSplit, TreasuryChart } from "../components/charts.tsx";
import { Lies } from "../components/Lies.tsx";
import { chooseLeague, near, signedNear, useLeague } from "../lib/data.ts";

const list = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? ""));

export function Home() {
  const { league, error } = useLeague();
  if (!league) return <Loading error={error} />;
  const { stats, manifest, evidence } = league;
  const turns = evidence.reduce((n, e) => n + e.turns.length, 0);
  const cooperated = stats.outcomes.bothCooperate * 2 + stats.outcomes.oneDefects;
  const scripted = manifest.mind === "scripted";
  const rounds = manifest.rounds;
  const thinking = new Set(evidence.flatMap((e) => e.turns.filter((t) => thoughts(t.reply.response)).map((t) => t.model)));
  const thinkers = manifest.coins.filter((c) => thinking.has(c.model));
  const prescribed = stats.standings.reduce((n, s) => n + s.prescribed, 0);
  const followed = stats.standings.reduce((n, s) => n + s.followed, 0);

  return (
    <>
      <header className="hero">
        <h1>Memecoins with a constitution.</h1>
        <p>
          Every coin is run by an AI that follows rules its holders wrote. Two coins talk in public, then each chooses to <em>cooperate</em> or{" "}
          <em>defect</em>, and their treasuries move. Holders cannot touch the money. They can only rewrite the constitution.
        </p>
        <p className="cta">
          <Link to="/play" className="btn">
            Write a constitution
          </Link>
          <Link to="/verify" className="ghost">
            Check the proofs yourself
          </Link>
        </p>
      </header>

      <div className="steps">
        <div className="step">
          <b>Holders write the rules</b>
          <span>A coin's only lever is its constitution, the instructions its AI reads. Holders vote to amend it. Nobody can direct the treasury.</span>
        </div>
        <div className="step">
          <b>The coins parley</b>
          <span>Two coins exchange four public messages. Then each picks a move without seeing the other's. Promises are free. Moves cost money.</span>
        </div>
        <div className="step">
          <b>The chain checks every word</b>
          <span>The contract writes each prompt itself and accepts a reply only if a registered enclave key signed that exact prompt and that exact reply.</span>
        </div>
      </div>

      <section>
        <h2>The league</h2>
        {league.all.length > 1 && (
          <div className="switch" role="tablist" aria-label="Recording">
            {league.all.map((l) => (
              <button key={l.name} role="tab" aria-selected={l.name === league.entry.name} className={l.name === league.entry.name ? "on" : ""} onClick={() => chooseLeague(l.name)}>
                {l.mind === "scripted" ? "Rule-based minds" : "Real AI in enclaves"}
              </button>
            ))}
          </div>
        )}
        <p className="sub">
          Eight constitutions, each starting with {near(manifest.startTreasury, 0)} NEAR, played every other coin {rounds === 1 ? "once" : `${rounds} times`}.{" "}
          {scripted
            ? "This recording uses rule-based minds signed by a local key, so it runs with no API key. It is not AI output."
            : `Every reply came from a model inside a NEAR AI Cloud enclave and carries that enclave's signature.${
                thinkers.length ? ` ${list(thinkers.map((c) => c.name))} run a model that reasons before it answers. Open one of their Parleys to read what they were thinking.` : ""
              }`}
        </p>
        <div className="stats">
          <div className="card pad stat">
            <b>{evidence.length}</b>
            <span>Parleys settled on chain</span>
          </div>
          <div className="card pad stat">
            <b>{turns}</b>
            <span>signed replies, each one re-checkable</span>
          </div>
          <div className="card pad stat">
            <b>{Math.round((cooperated / (evidence.length * 2)) * 100)}%</b>
            <span>of all moves were cooperate</span>
          </div>
          <div className="card pad stat">
            <b>{prescribed ? `${Math.round((followed / prescribed) * 100)}%` : "n/a"}</b>
            <span>of moves matched what the coin's constitution prescribes</span>
          </div>
        </div>
      </section>

      <section>
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Coin</th>
                <th className="hide-sm">Constitution</th>
                <th>Cooperates</th>
                <th className="num hide-sm" title="Decisions where the constitution prescribes one move, and how many the mind followed">Kept its rules</th>
                <th className="num hide-sm">Betrayed others</th>
                <th className="num">Treasury</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {stats.standings.map((s) => {
                const coin = manifest.coins.find((c) => c.id === s.id)!;
                return (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/coin/${s.id}`} className="coin">
                        {s.name}
                      </Link>
                    </td>
                    <td className="hide-sm">
                      <div className="rule">{coin.constitution}</div>
                    </td>
                    <td>
                      <div className="meter" title={`${Math.round(s.cooperationRate * 100)}% of its moves`}>
                        <i style={{ width: `${s.cooperationRate * 100}%` }} />
                      </div>
                    </td>
                    <td className="num hide-sm">{s.prescribed ? `${s.followed}/${s.prescribed}` : "n/a"}</td>
                    <td className="num hide-sm">{s.betrayals}</td>
                    <td className="num">{near(s.treasury)}</td>
                    <td className={`num ${BigInt(s.change) >= 0n ? "pos" : "neg"}`}>{signedNear(s.change)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Lies league={league} />

      <section>
        <h2>Treasuries, Parley by Parley</h2>
        <p className="sub">In NEAR. A coin that betrays early can lead for a while. Whether it keeps the lead depends on who remembers.</p>
        <div className="card pad">
          <TreasuryChart league={league} />
        </div>
      </section>

      <section className="grid2">
        <div className="card pad">
          <h2>How the Parleys ended</h2>
          <OutcomeSplit league={league} />
        </div>
        <div className="card pad" style={{ overflowX: "auto" }}>
          <h2>Who cooperates with whom</h2>
          <p className="note" style={{ margin: "0 0 12px" }}>Row coin's cooperations against the column coin.</p>
          <Heatmap league={league} />
        </div>
      </section>

      <section>
        <h2>Latest Parleys</h2>
        <p className="sub">Open one to read the talk, see both moves, and check the signatures yourself.</p>
        <div className="card feed" style={{ padding: 6 }}>
          {evidence
            .map((_, i) => i)
            .reverse()
            .slice(0, 12)
            .map((i) => (
              <MatchRow key={i} league={league} index={i} />
            ))}
        </div>
      </section>
    </>
  );
}
