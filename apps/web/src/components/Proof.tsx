import { verifyReply } from "@parley/sdk/src/enclave.ts";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import type { Line, Match } from "../lib/model.ts";
import { ShieldCheckIcon } from "./icons.tsx";

const short = (hex: string, n = 10) => (hex.length > n * 2 ? `${hex.slice(0, n)}…${hex.slice(-6)}` : hex);

/** A drawer that re-checks one reply's enclave signature in the browser and shows what was signed. */
export function Proof({ line, match, name, onClose }: { line: Line; match: Match; name: (id: string) => string; onClose: () => void }) {
  const [raw, setRaw] = useState(false);
  const proof = line.proof;
  const ok = useMemo(() => (proof ? verifyReply(proof.model, proof.request, proof.reply) : false), [proof]);
  if (!proof) return null;
  const who = name(line.side === "A" ? match.a : match.b);
  const prompt = (JSON.parse(proof.request) as { messages: { content: string }[] }).messages[1]?.content ?? "";

  return (
    <motion.div className="drawer-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside
        className="drawer"
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="drawer-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className={`proof-badge ${ok ? "ok" : "bad"}`}>
          <ShieldCheckIcon size={28} />
          <div>
            <strong>{ok ? "Checked in your browser just now" : "This signature does not match"}</strong>
            <span>{ok ? `This is exactly what ${who}'s AI said. Nobody edited it.` : "Someone changed these bytes."}</span>
          </div>
        </div>

        <ol className="proof-steps">
          <li>
            <b>The blockchain wrote the question.</b> Nobody in between could change a word of it.
          </li>
          <li>
            <b>The AI answered inside sealed hardware</b> at NEAR AI Cloud, running <code>{proof.model}</code>.
          </li>
          <li>
            <b>The hardware stamped the answer</b> with a key that never leaves it. The stamp covers the exact question and the exact answer.
          </li>
          <li>
            <b>The contract checked the stamp</b> before it counted the turn, and your browser just checked it again.
          </li>
        </ol>

        <h4>What the contract asked {who}</h4>
        <pre className="prompt">{prompt}</pre>

        <button className="link-btn" onClick={() => setRaw((v) => !v)}>
          {raw ? "Hide the raw proof" : "Show the raw proof"}
        </button>
        {raw && (
          <dl className="raw">
            <dt>Hardware key</dt>
            <dd>{short(proof.reply.publicKey, 16)}</dd>
            <dt>Signature</dt>
            <dd>{short(proof.reply.signature, 16)}</dd>
            <dt>Signed text</dt>
            <dd>model : sha256(request) : sha256(response)</dd>
            <dt>Raw response</dt>
            <dd className="mono-block">{proof.reply.response}</dd>
          </dl>
        )}
      </motion.aside>
    </motion.div>
  );
}
