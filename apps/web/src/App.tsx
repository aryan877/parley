import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Alerts } from "./components/Alerts.tsx";
import { Mark } from "./components/Mark.tsx";
import { TabBar } from "./components/TabBar.tsx";
import { WalletButton } from "./components/WalletButton.tsx";
import { accountLink, useArenaInfo } from "./lib/live.ts";
import { useNearTrouble } from "./lib/near.ts";
import { Arena } from "./pages/Arena.tsx";
import { CoinView } from "./pages/CoinView.tsx";
import { Coins } from "./pages/Coins.tsx";
import { Launch } from "./pages/Launch.tsx";
import { MatchView } from "./pages/MatchView.tsx";
import { Matches } from "./pages/Matches.tsx";
import { ProofPage } from "./pages/ProofPage.tsx";

function Reconnecting() {
  const trouble = useNearTrouble();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(trouble), trouble ? 1000 : 4000);
    return () => clearTimeout(timer);
  }, [trouble]);
  return (
    <AnimatePresence>
      {shown && (
        <motion.div className="near-trouble" role="status" initial={{ opacity: 0, x: "-50%", y: -8 }} animate={{ opacity: 1, x: "-50%", y: 0 }} exit={{ opacity: 0, x: "-50%", y: -8 }}>
          Reconnecting to NEAR… The numbers shown are the last ones we read.
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function App() {
  const link = ({ isActive }: { isActive: boolean }) => `navlink${isActive ? " active" : ""}`;
  const { pathname } = useLocation();
  const { info } = useArenaInfo();
  const contract = info ? accountLink(info, info.contractId) : null;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <Mark />
            Parley
          </NavLink>
          <nav className="nav-links">
            <NavLink to="/" end className={link}>
              Arena
            </NavLink>
            <NavLink to="/coins" className={link}>
              Coins
            </NavLink>
            <NavLink to="/matches" className={link}>
              Matches
            </NavLink>
            <NavLink to="/proof" className={link}>
              Proof
            </NavLink>
          </nav>
          <span className="spacer" />
          <NavLink to="/launch" className="btn ghost top-launch">
            <span className="hide-sm">Launch a coin</span>
            <span className="show-sm">Launch</span>
          </NavLink>
          <WalletButton />
        </div>
        <Reconnecting />
      </header>
      <main className="shell">
        <Routes>
          <Route path="/" element={<Arena />} />
          <Route path="/coins" element={<Coins />} />
          <Route path="/coin/:id" element={<CoinView />} />
          <Route path="/matches" element={<Matches />} />
          <Route path="/match/:id" element={<MatchView />} />
          <Route path="/season/match/:id" element={<MatchView season />} />
          <Route path="/season/coin/:id" element={<CoinView season />} />
          <Route path="/launch" element={<Launch />} />
          <Route path="/proof" element={<ProofPage />} />
          <Route path="/play" element={<Navigate to="/launch" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <footer className="foot">
          <a href="https://near.ai" target="_blank" rel="noreferrer">
            Parley runs on <img src="./brand/near-ai-white.svg" alt="NEAR AI" />
          </a>
          {info && contract && (
            <a href={contract} target="_blank" rel="noreferrer" className="foot-contract">
              Contract on {info.network === "testnet" ? "NEAR testnet" : "NEAR"}: <b>{info.contractId}</b>
            </a>
          )}
          <span>Test money only. Not audited.</span>
        </footer>
      </main>
      <TabBar />
      <Alerts />
    </>
  );
}
