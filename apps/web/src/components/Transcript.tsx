import { thoughts } from "@parley/league/src/browser.ts";
import { verifyReply } from "@parley/sdk/src/enclave.ts";
import type { Parley, SignedReply } from "@parley/sdk/src/types.ts";
import { useMemo, useState } from "react";
import { short } from "../lib/data.ts";
import { Delta } from "./bits.tsx";

export interface SignedTurn {
  model: string;
  request: string;
  reply: SignedReply;
}

interface Props {
  parley: Parley;
  turns: SignedTurn[];
  name: (coin: string) => string;
  /** How many talk messages to show, for a replay. Leave out to show everything the chain has. */
  shown?: number;
  /** Keeps both moves face down until the Parley has settled. */
  sealed?: boolean;
}

/** The talk and the two moves of one Parley, with every turn's signature re-checked in the browser. */
export function Transcript({ parley, turns, name, shown, sealed }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const [reading, setReading] = useState<number | null>(null);
  const checks = useMemo(() => turns.map((t, i) => verifyReply(i % 2 === 0 ? parley.a_model : parley.b_model, t.request, t.reply)), [turns, parley]);
  const minds = useMemo(() => turns.map((t) => thoughts(t.reply.response)), [turns]);
  const who = (side: string) => name(side === "A" ? parley.a : parley.b);
  const all = parley.turns.map((t, i) => ({ t, i })).filter(({ i }) => turns[i]);
  const spoken = all.filter(({ t }) => t.kind === "Talk");
  const talk = spoken.filter((_, n) => shown === undefined || n < shown);
  const decisions = all.filter(({ t }) => t.kind === "Decide");
  const faceUp = !(sealed && parley.status !== "Settled") && (shown === undefined || shown > spoken.length);

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
        <p>{reading === i ? minds[i] : minds[i]!.replace(/\s+/g, " ")}</p>
        <button onClick={() => setReading(reading === i ? null : i)}>{reading === i ? "Show less" : "Read all of it"}</button>
      </div>
    ) : null;

  return (
    <div className="card">
      <div className="talk">
        {talk.map(({ t, i }) => (
          <div key={i} className={`line ${t.side === "A" ? "a" : "b"}${shown === undefined && !sealed ? "" : " reveal"}`}>
            <div className="who">
              {who(t.side)}
              {badge(i)}
            </div>
            {thought(i, t.side)}
            <div className="bubble">{t.text}</div>
            {open === i && evidence(i)}
          </div>
        ))}
        {!talk.length && <p className="note" style={{ margin: 0 }}>Waiting for the first message…</p>}
      </div>
      <div className="verdict">
        {(["A", "B"] as const).map((side) => {
          const found = decisions.find(({ t }) => t.side === side);
          const move = side === "A" ? parley.a_move : parley.b_move;
          if (!found || !faceUp) {
            return (
              <div key={side}>
                <div className="who" style={{ color: "var(--faint)", fontSize: 12, marginBottom: 8 }}>
                  {who(side)} {found ? "has chosen" : "has not chosen yet"}
                </div>
                <div className="move" style={{ color: "var(--faint)" }}>
                  {found ? "sealed" : "?"}
                </div>
              </div>
            );
          }
          return (
            <div key={side} className="reveal">
              <div className="who" style={{ color: "var(--faint)", fontSize: 12, marginBottom: 8 }}>
                {who(side)} chose
              </div>
              <div className="move" style={{ color: move === "Cooperate" ? "var(--green)" : "var(--red)" }}>
                {move}
              </div>
              <div style={{ margin: "10px 0" }}>
                <Delta yocto={side === "A" ? parley.a_delta : parley.b_delta} /> <span style={{ color: "var(--faint)" }}>NEAR</span>
              </div>
              {badge(found.i)}
              {thought(found.i, side)}
              {open === found.i && evidence(found.i)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
