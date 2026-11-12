import { AnimatePresence, motion } from "motion/react";
import { Link } from "react-router-dom";
import { fmtNear } from "../lib/model.ts";
import { shortAccount, useWallet } from "../lib/wallet.tsx";
import { WalletGuide } from "./Guide.tsx";
import { ArrowIcon, WalletIcon } from "./icons.tsx";
import { Mascot } from "./Mascot.tsx";

export function WalletModal() {
  const w = useWallet();
  const network = w.info?.network;
  const playable = network === "local" || network === "testnet";
  return (
    <AnimatePresence>
      {w.open && (
        <motion.div className="drawer-back center-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => w.setOpen(false)}>
          <motion.div className="modal" initial={{ y: 20, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
            <button className="drawer-close" onClick={() => w.setOpen(false)} aria-label="Close">
              ×
            </button>
            <h3>Get a wallet</h3>
            <p className="muted">You need one to launch a coin, buy shares or vote.</p>
            <WalletGuide />
            {!w.info ? (
              <div className="notice">The arena is offline right now. You can still watch Season 1.</div>
            ) : playable ? (
              <>
                <motion.button className="wallet-option featured" onClick={() => w.connectPlay()} disabled={w.busy} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
                  <span className="wallet-ico">
                    <Mascot id="wallet" size={34} mood={w.busy ? "thinking" : "win"} />
                  </span>
                  <span>
                    <b>{w.busy ? "Making your wallet…" : "Free play wallet"}</b>
                    <small>{network === "testnet" ? "Test NEAR, no sign-up. Ready in one click." : "Free test NEAR on a local test chain. Ready in one click."}</small>
                  </span>
                  <ArrowIcon size={18} className="wallet-go" />
                </motion.button>
                <p className="wallet-note">The key stays in this browser.</p>
              </>
            ) : (
              <div className="notice">Play wallets work on NEAR testnet only.</div>
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
    return (
      <Link to="/coins?tab=mine" className="wallet-chip" title={`${shortAccount(w.accountId)}: see your coins`}>
        <Mascot id={w.accountId} size={26} />
        <span className="acct">My coins</span>
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
