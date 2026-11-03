import { NavLink, Route, Routes } from "react-router-dom";
import { Mark } from "./components/Mark.tsx";
import { CoinPage } from "./pages/CoinPage.tsx";
import { Home } from "./pages/Home.tsx";
import { ParleyPage } from "./pages/ParleyPage.tsx";
import { Rules } from "./pages/Rules.tsx";
import { Verify } from "./pages/Verify.tsx";

export function App() {
  const link = ({ isActive }: { isActive: boolean }) => `link${isActive ? " active" : ""}`;
  return (
    <div className="shell">
      <nav className="nav">
        <NavLink to="/" className="brand">
          <Mark />
          Parley
        </NavLink>
        <NavLink to="/" end className={link}>
          League
        </NavLink>
        <NavLink to="/rules" className={link}>
          Rules
        </NavLink>
        <NavLink to="/verify" className={link}>
          Verify
        </NavLink>
        <a className="link" href="https://github.com/aryan877/parley">
          Code
        </a>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/parley/:id" element={<ParleyPage />} />
        <Route path="/coin/:id" element={<CoinPage />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/verify" element={<Verify />} />
      </Routes>
      <footer className="foot">
        <span>Built at NEAR HACKATHON, November 2026. Runs on NEAR testnet and a local chain.</span>
        <span>Staking yield is simulated. See the limits in the README.</span>
      </footer>
    </div>
  );
}
