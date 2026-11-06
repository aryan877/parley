import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Delta, Loading, nameOf } from "../components/bits.tsx";
import { Transcript } from "../components/Transcript.tsx";
import { near, useLeague } from "../lib/data.ts";

export function ParleyPage() {
  const { id } = useParams();
  const { league, error } = useLeague();
  const [query] = useSearchParams();
  const [step, setStep] = useState<number | null>(query.has("replay") ? 0 : null);
  const item = league?.evidence.find((e) => e.parley.id === Number(id));
  const talkCount = item?.parley.turns.filter((t) => t.kind === "Talk").length ?? 0;

  useEffect(() => {
    if (step === null) return;
    if (step > talkCount + 1) return setStep(null);
    const timer = setTimeout(() => setStep(step + 1), step < talkCount ? 1700 : 1500);
    return () => clearTimeout(timer);
  }, [step, talkCount]);
  useEffect(() => setStep(query.has("replay") ? 0 : null), [id, query]);

  if (!league) return <Loading error={error} />;
  if (!item) return <p className="sub">No such Parley in this recording.</p>;
  const { parley, turns } = item;
  const [a, b] = [nameOf(league, parley.a), nameOf(league, parley.b)];
  const at = league.evidence.indexOf(item);
  const previous = league.evidence[at - 1];
  const next = league.evidence[at + 1];

  return (
    <>
      <div className="crumbs">
        <Link to="/">League</Link> / Parley #{parley.id}
      </div>
      <h1 className="title">
        <Link to={`/coin/${parley.a}`}>{a}</Link> <span style={{ color: "var(--faint)" }}>meets</span> <Link to={`/coin/${parley.b}`}>{b}</Link>
      </h1>
      <p className="sub">
        {near(parley.stake)} NEAR at stake for each. Nonce <span style={{ fontFamily: "var(--mono)" }}>{parley.nonce}</span>.
      </p>
      <p className="sub">
        <span className="tag">
          {a}: {parley.a_model}
        </span>{" "}
        <span className="tag">
          {b}: {parley.b_model}
        </span>
      </p>

      <Transcript parley={parley} turns={turns} name={(coin) => nameOf(league, coin)} shown={step ?? undefined} />

      <p className="note">
        Commons change: <Delta yocto={parley.commons_delta} /> NEAR. Neither coin's prompt for its move contained the other's move. Click a "signed" tag to
        see the prompt and re-check the signature.
      </p>
      <p className="note">
        <button className="ghost" onClick={() => setStep(0)}>
          {step === null ? "Replay this Parley" : "Replaying…"}
        </button>
      </p>
      <p className="pager">
        {previous ? <Link to={`/parley/${previous.parley.id}`}>← Parley #{previous.parley.id}</Link> : <span />}
        {next ? <Link to={`/parley/${next.parley.id}`}>Parley #{next.parley.id} →</Link> : <span />}
      </p>
    </>
  );
}
