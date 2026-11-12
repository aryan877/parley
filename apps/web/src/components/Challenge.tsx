import type { Coin } from "@parley/sdk/src/types.ts";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { sendChallenge } from "../lib/arena.ts";
import { YourMatches } from "./ArenaNow.tsx";
import { Mascot } from "./Mascot.tsx";
import { RestartIcon } from "./icons.tsx";

const place = (ahead: number) => (ahead === 0 ? "It plays next." : `${ahead} ${ahead === 1 ? "match plays" : "matches play"} before it.`);

function useSend() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ coin: string; ahead: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async (coin: string, rival: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSent({ coin, ahead: await sendChallenge(coin, [rival]) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, sent, error, send };
}

const Notes = ({ sent, error, text }: { sent: { ahead: number } | null; error: string | null; text: string }) => (
  <AnimatePresence>
    {sent && (
      <motion.div key="sent" className="notice good" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        {text} {place(sent.ahead)}
      </motion.div>
    )}
    {error && (
      <motion.div key="error" className="notice bad" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        {error}
      </motion.div>
    )}
  </AnimatePresence>
);

/** On a coin page: send one of the visitor's own coins to meet this one. */
export function Challenge({ mine, rival, name }: { mine: Coin[]; rival: string; name: (id: string) => string }) {
  const [pick, setPick] = useState(mine[0]?.id ?? "");
  const { busy, sent, error, send } = useSend();
  const coin = mine.find((c) => c.id === pick) ?? mine[0];
  if (!coin) return null;
  const inLine = sent?.coin === coin.id;
  return (
    <div className="glass challenge">
      <div className="challenge-main">
        <h3>
          Think {coin.name} can take on {name(rival)}?
        </h3>
        <p className="muted small challenge-hint">It joins the line, and the two meet live. You can watch it here.</p>
      </div>
      <div className="challenge-act">
        {mine.length > 1 && (
          <div className="challenge-pick" role="radiogroup" aria-label="Your coin">
            {mine.map((c) => (
              <button key={c.id} role="radio" aria-checked={c.id === coin.id} className={c.id === coin.id ? "on" : ""} onClick={() => setPick(c.id)}>
                <Mascot id={c.id} size={22} /> {c.name}
              </button>
            ))}
          </div>
        )}
        <motion.button className="btn" disabled={busy || inLine} onClick={() => send(coin.id, rival)} whileTap={{ scale: 0.97 }}>
          {busy ? "Sending…" : inLine ? `${coin.name} is in line` : `Challenge with ${coin.name}`}
        </motion.button>
      </div>
      <Notes sent={sent} error={error} text={`Sent. ${name(sent?.coin ?? coin.id)} meets ${name(rival)} live.`} />
    </div>
  );
}

/** After a finished match: put the same two coins back in the line. */
export function Rematch({ mine, rival, name }: { mine: string; rival: string; name: (id: string) => string }) {
  const { busy, sent, error, send } = useSend();
  return (
    <>
      <motion.button className="btn small-btn" disabled={busy || !!sent} onClick={() => send(mine, rival)} whileTap={{ scale: 0.97 }}>
        <RestartIcon size={16} /> {busy ? "Sending…" : sent ? "Rematch is in line" : "Rematch"}
      </motion.button>
      {(sent || error) && (
        <div className="rematch-notes">
          <Notes sent={sent} error={error} text={`${name(mine)} and ${name(rival)} meet again.`} />
          {sent && <YourMatches coins={[mine]} name={name} />}
        </div>
      )}
    </>
  );
}
