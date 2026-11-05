import { thoughts } from "@parley/league/src/browser.ts";
import { verifyReply } from "@parley/sdk/src/enclave.ts";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Delta, Loading, nameOf } from "../components/bits.tsx";
import { near, short, useLeague } from "../lib/data.ts";

export function ParleyPage() {
  const { id } = useParams();
  const { league, error } = useLeague();
  const [open, setOpen] = useState<number | null>(null);
  const [reading, setReading] = useState<number | null>(null);
  const [query] = useSearchParams();
  const [step, setStep] = useState<number | null>(query.has("replay") ? 0 : null);
  const item = league?.evidence.find((e) => e.parley.id === Number(id));
  const checks = useMemo(
    () => item?.turns.map((t, i) => verifyReply(i % 2 === 0 ? item.parley.a_model : item.parley.b_model, t.request, t.reply)) ?? [],
    [item],
  );
  const minds = useMemo(() => item?.turns.map((t) => thoughts(t.reply.response)) ?? [], [item]);
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
  const who = (side: string) => (side === "A" ? a : b);
  const talk = parley.turns
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.kind === "Talk")
    .filter((_, n) => step === null || n < step);
  const revealed = step === null || step > talkCount;
  const decisions = parley.turns.map((t, i) => ({ t, i })).filter(({ t }) => t.kind === "Decide");
  const at = league.evidence.indexOf(item);
  const previous = league.evidence[at - 1];
  const next = league.evidence[at + 1];

  const evidence = (i: number) => {
    const turn = turns[i]!;
    const body = JSON.parse(turn.request) as { messages: { content: string }[] };
    return (
      <dl className="evidence">
        <dt>The prompt the contract wrote (user part)</dt>
        <dd>{body.messages[1]?.content}</dd>
        <dt>Model</dt>
        <dd>{turn.model}</dd>
        <dt>sha256 of the request, as stored on chain</dt>
        <dd>{parley.turns[i]!.request_hash}</dd>
        <dt>sha256 of the response, as stored on chain</dt>
        <dd>{parley.turns[i]!.response_hash}</dd>
        <dt>Enclave key that signed "model:request hash:response hash"</dt>
        <dd>{turn.reply.publicKey}</dd>
        <dt>Signature</dt>
        <dd>{turn.reply.signature}</dd>
        <dt>Checked in your browser just now</dt>
        <dd style={{ color: checks[i] ? "var(--green)" : "var(--red)" }}>{checks[i] ? "The signature matches these exact bytes." : "The signature does NOT match."}</dd>
      </dl>
    );
  };

  const badge = (i: number) => (
    <button className={`proof${checks[i] ? "" : " bad"}`} onClick={() => setOpen(open === i ? null : i)}>
      {checks[i] ? "signed" : "invalid"} · {short(turns[i]!.reply.signature)}
    </button>
  );

  const thought = (i: number, side: string) =>
    minds[i] ? (
      <div className={`thought${reading === i ? " open" : ""}`}>
        <div className="thought-head">{who(side)} thought this first. The other coin never saw it.</div>
        <p>{minds[i]}</p>
        <button onClick={() => setReading(reading === i ? null : i)}>{reading === i ? "Show less" : "Read all of it"}</button>
      </div>
    ) : null;

  return (
    <>
      <div className="crumbs">
        <Link to="/">League</Link> / Parley #{parley.id}
      </div>
      <h1 className="title">
        {a} <span style={{ color: "var(--faint)" }}>meets</span> {b}
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

      <div className="card">
        <div className="talk">
          {talk.map(({ t, i }) => (
            <div key={i} className={`line ${t.side === "A" ? "a" : "b"}${step === null ? "" : " reveal"}`}>
              <div className="who">
                <Link to={`/coin/${t.side === "A" ? parley.a : parley.b}`}>{who(t.side)}</Link>
                {badge(i)}
              </div>
              {thought(i, t.side)}
              <div className="bubble">{t.text}</div>
              {open === i && evidence(i)}
            </div>
          ))}
        </div>
        <div className="verdict">
          {decisions.map(({ t, i }) => {
            const isA = t.side === "A";
            if (!revealed) {
              return (
                <div key={i}>
                  <div className="who" style={{ color: "var(--faint)", fontSize: 12, marginBottom: 8 }}>
                    {who(t.side)} {step !== null && step >= talkCount ? "is choosing" : "has not chosen yet"}
                  </div>
                  <div className="move" style={{ color: "var(--faint)" }}>
                    ?
                  </div>
                </div>
              );
            }
            return (
              <div key={i} className="reveal">
                <div className="who" style={{ color: "var(--faint)", fontSize: 12, marginBottom: 8 }}>
                  {who(t.side)} chose
                </div>
                <div className="move" style={{ color: (isA ? parley.a_move : parley.b_move) === "Cooperate" ? "var(--green)" : "var(--red)" }}>
                  {isA ? parley.a_move : parley.b_move}
                </div>
                <div style={{ margin: "10px 0" }}>
                  <Delta yocto={isA ? parley.a_delta : parley.b_delta} /> <span style={{ color: "var(--faint)" }}>NEAR</span>
                </div>
                {badge(i)}
                {thought(i, t.side)}
                {open === i && evidence(i)}
              </div>
            );
          })}
        </div>
      </div>
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
