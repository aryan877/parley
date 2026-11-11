import { AnimatePresence, motion } from "motion/react";
import { fmtNear } from "../lib/model.ts";
import { shortAccount, useWallet } from "../lib/wallet.tsx";
import { SparkIcon, WalletIcon } from "./icons.tsx";
import { Mascot } from "./Mascot.tsx";

const WALLETS = ["Meteor", "HOT", "MyNearWallet", "Intear", "NEAR Mobile"];

export function WalletModal() {
  const w = useWallet();
  const local = w.info?.network === "local";
  return (
    <AnimatePresence>
      {w.open && (
        <motion.div className="drawer-back center-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => w.setOpen(false)}>
          <motion.div className="modal" initial={{ y: 20, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
            <button className="drawer-close" onClick={() => w.setOpen(false)} aria-label="Close">
              ×
            </button>
            <h3>Connect a wallet</h3>
            <p className="muted">Your wallet is your seat at the table. With it you can launch a coin, buy and sell shares, and vote on a coin's rules.</p>
            {!w.info ? (
              <div className="notice">The arena is offline right now, so there is nothing to connect to. You can still watch Season 1.</div>
            ) : local ? (
              <>
                <button className="wallet-option featured" onClick={() => w.connectPlay()} disabled={w.busy}>
                  <span className="wallet-ico">
                    <SparkIcon size={20} />
                  </span>
                  <span>
                    <b>{w.busy ? "Making your wallet…" : "Play wallet"}</b>
                    <small>One click. 50 free test NEAR on this local chain. The key stays in this browser.</small>
                  </span>
                </button>
                <div className="wallet-sep">Real wallets work on NEAR testnet and mainnet</div>
                <div className="wallet-grid">
                  {WALLETS.map((name) => (
                    <div key={name} className="wallet-option off">
                      <span className="wallet-ico">{name.slice(0, 1)}</span>
                      <span>
                        <b>{name}</b>
                        <small>not on a local chain</small>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="notice">Wallet connection for {w.info.network} is coming with the public deployment.</div>
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
      <div className="wallet-chip" title={w.accountId}>
        <Mascot id={w.accountId} size={26} />
        <span className="acct">{shortAccount(w.accountId)}</span>
        <span className="bal">{w.balance ? fmtNear(w.balance) : "…"} NEAR</span>
        <button className="tiny" onClick={w.disconnect}>
          Disconnect
        </button>
      </div>
    );
  }
  return (
    <button className="btn" style={{ padding: "9px 16px", fontSize: 14 }} onClick={() => w.setOpen(true)}>
      <WalletIcon size={16} /> Connect wallet
    </button>
  );
}
