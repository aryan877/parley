import type { JSX } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChatIcon, CoinIcon, PlayIcon, ShieldCheckIcon, SparkIcon } from "./icons.tsx";

const TABS: { to: string; label: string; icon: (size: number) => JSX.Element; on: (path: string) => boolean }[] = [
  { to: "/", label: "Arena", icon: (s) => <PlayIcon size={s} />, on: (p) => p === "/" },
  { to: "/coins", label: "Coins", icon: (s) => <CoinIcon size={s} />, on: (p) => p.startsWith("/coin") || p.startsWith("/season/coin") },
  { to: "/launch", label: "Launch", icon: (s) => <SparkIcon size={s} />, on: (p) => p.startsWith("/launch") },
  { to: "/matches", label: "Matches", icon: (s) => <ChatIcon size={s} />, on: (p) => p.startsWith("/match") || p.startsWith("/season/match") },
  { to: "/proof", label: "Proof", icon: (s) => <ShieldCheckIcon size={s} />, on: (p) => p.startsWith("/proof") },
];

/** Bottom navigation on phones. Hidden on wider screens by CSS. */
export function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => {
        const on = t.on(pathname);
        return (
          <Link key={t.to} to={t.to} className={`tab ${on ? "on" : ""} ${t.to === "/launch" ? "launch" : ""}`} aria-current={on ? "page" : undefined}>
            <span className="tab-icon">{t.icon(22)}</span>
            <span className="tab-label">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
