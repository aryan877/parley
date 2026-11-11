import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Mark } from "./components/Mark.tsx";
import { WalletButton } from "./components/WalletButton.tsx";
import { Arena } from "./pages/Arena.tsx";
import { CoinView } from "./pages/CoinView.tsx";
import { Coins } from "./pages/Coins.tsx";
import { Launch } from "./pages/Launch.tsx";
import { MatchView } from "./pages/MatchView.tsx";
import { Matches } from "./pages/Matches.tsx";
import { ProofPage } from "./pages/ProofPage.tsx";

export function App() {
  const link = ({ isActive }: { isActive: boolean }) => `navlink${isActive ? " active" : ""}`;
  const { pathname } = useLocation();
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
          <span className="spacer" />
          <NavLink to="/launch" className="btn ghost" style={{ padding: "9px 16px", fontSize: 14 }}>
            Launch a coin
          </NavLink>
          <WalletButton />
        </div>
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
        </Routes>
        <footer className="foot">
          <a href="https://near.ai" target="_blank" rel="noreferrer">
            Parley runs on <img src="./brand/near-ai-white.svg" alt="NEAR AI" />
          </a>
          <span>Unaudited. Test money only. Read the limits in the README.</span>
        </footer>
      </main>
    </>
  );
}
