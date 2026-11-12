import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fmtNear } from "../lib/model.ts";
import { type WalletChoice, shortAccount, useWallet } from "../lib/wallet.tsx";
import { ArrowIcon, WalletIcon } from "./icons.tsx";
import { Mascot } from "./Mascot.tsx";

const FAUCET = "https://near-faucet.io/";

const Faucet = ({ lead }: { lead: string }) => (
  <p className="wallet-note">
    {lead}{" "}
    <a href={FAUCET} target="_blank" rel="noreferrer">
      near-faucet.io
    </a>
  </p>
);

function NearPicker({ onBack }: { onBack: () => void }) {
  const w = useWallet();
  const [choices, setChoices] = useState<WalletChoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);

  const load = () => {
    setFailed(false);
    setChoices(null);
    w.nearWallets().then(
      (list) => (list.length ? setChoices(list) : setFailed(true)),
      () => setFailed(true),
    );
  };
  useEffect(load, []);

  const join = async (id: string) => {
    setJoining(id);
    await w.connectNear(id);
    setJoining(null);
  };

  return (
    <>
      <button className="wallet-back" onClick={onBack}>
        <ArrowIcon size={16} className="icon-mirror" /> Back
      </button>
      <h3>Pick your wallet</h3>
      <p className="muted">NEAR testnet. Some open a new window to sign, so keep this tab open.</p>
      {failed ? (
        <div className="notice">
          Could not load the wallet list.{" "}
          <button className="tiny" onClick={load}>
            Try again
          </button>
        </div>
      ) : !choices ? (
        <div className="wallet-loading">
          <Mascot id="wallet" size={40} mood="thinking" />
          <span>Loading wallets…</span>
        </div>
      ) : (
        <div className="wallet-list">
          {choices.map((c) => (
            <motion.button key={c.id} className="wallet-option" onClick={() => join(c.id)} disabled={!!joining} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
              <img className="wallet-logo" src={c.icon} alt="" loading="lazy" />
              <span>
                <b>{c.name}</b>
                <small>{joining === c.id ? "Check your wallet…" : c.note}</small>
              </span>
              <ArrowIcon size={16} className="wallet-go" />
            </motion.button>
          ))}
        </div>
      )}
      <Faucet lead="No test NEAR yet? Get some free at" />
    </>
  );
}

export function WalletModal() {
  const w = useWallet();
  const [step, setStep] = useState<"start" | "near">("start");
  const network = w.info?.network;
  const playable = network === "local" || network === "testnet";

  useEffect(() => {
    if (!w.open) setStep("start");
  }, [w.open]);

  const playTitle = w.busy ? "Making your wallet…" : w.kind === "play" ? "Your play wallet" : w.hasPlay ? "Back to your play wallet" : "Free play wallet";
  const playNote =
    w.kind === "play"
      ? "In use now."
      : w.hasPlay
        ? "The one this browser already keeps."
        : network === "testnet"
          ? "Test NEAR, no sign-up. Ready in one click."
          : "Free test NEAR on a local test chain. Ready in one click.";
  const nearNote = !w.nearReady
    ? "Works on the live site, on NEAR testnet."
    : w.kind === "near"
      ? `In use now: ${w.walletName ?? shortAccount(w.accountId ?? "")}`
      : "Meteor, Intear, Nightly and more, on testnet.";

  return (
    <AnimatePresence>
      {w.open && (
        <motion.div className="drawer-back center-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => w.setOpen(false)}>
          <motion.div className="modal" initial={{ y: 20, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
            <button className="drawer-close" onClick={() => w.setOpen(false)} aria-label="Close">
              ×
            </button>
            {step === "near" && w.nearReady ? (
              <NearPicker onBack={() => setStep("start")} />
            ) : (
              <>
                <h3>{w.accountId ? "Switch wallet" : "Get a wallet"}</h3>
                <p className="muted">{w.accountId ? "Pick which one signs for you." : "You need one to launch a coin, buy shares or vote."}</p>
                {!w.info ? (
                  <div className="notice">The arena is offline right now. You can still watch Season 1.</div>
                ) : (
                  <>
                    {playable ? (
                      <>
                        <motion.button className="wallet-option featured" onClick={() => w.connectPlay()} disabled={w.busy} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
                          <span className="wallet-ico">
                            <Mascot id="wallet" size={34} mood={w.busy ? "thinking" : "win"} />
                          </span>
                          <span>
                            <b>{playTitle}</b>
                            <small>{playNote}</small>
                          </span>
                          <ArrowIcon size={18} className="wallet-go" />
                        </motion.button>
                        <p className="wallet-note">The key stays in this browser.</p>
                      </>
                    ) : (
                      <div className="notice">Play wallets work on NEAR testnet only.</div>
                    )}
                    <motion.button
                      className={`wallet-option own${w.nearReady ? "" : " off"}`}
                      onClick={() => w.nearReady && (w.kind === "near" ? w.setOpen(false) : setStep("near"))}
                      disabled={!w.nearReady || w.busy}
                      whileHover={w.nearReady ? { y: -2 } : undefined}
                      whileTap={w.nearReady ? { scale: 0.98 } : undefined}
                    >
                      <span className="wallet-ico">
                        <WalletIcon size={22} />
                      </span>
                      <span>
                        <b>{w.kind === "near" ? "Your NEAR wallet" : "Your own NEAR wallet"}</b>
                        <small>{nearNote}</small>
                      </span>
                      <ArrowIcon size={18} className="wallet-go" />
                    </motion.button>
                    {w.nearReady && w.kind !== "near" && <Faucet lead="You need test NEAR for it. Get some free at" />}
                  </>
                )}
              </>
            )}
            {w.error && <div className="notice bad">{w.error}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function WalletButton() {
  const w = useWallet();
  if (w.accountId) {
    const own = w.kind === "near";
    return (
      <Link to="/coins?tab=mine" className="wallet-chip" title={own ? `${w.accountId}: see your coins` : `${shortAccount(w.accountId)}: see your coins`}>
        <Mascot id={w.accountId} size={26} />
        <span className="acct">{own ? shortAccount(w.accountId) : "My coins"}</span>
        <span className="bal">{w.balance ? fmtNear(w.balance) : "…"} NEAR</span>
      </Link>
    );
  }
  return (
    <button className="btn top-wallet" onClick={() => w.setOpen(true)}>
      <WalletIcon size={16} /> Get a wallet
    </button>
  );
}
