import { motion } from "motion/react";
import { Fragment, type ReactNode } from "react";
import { ArrowIcon, AskIcon, BetrayIcon, BlocksIcon, BrainIcon, ChartIcon, ChatIcon, ChipIcon, ClockIcon, CoinIcon, PenIcon, ShieldCheckIcon, ShuffleIcon, TrustIcon, VoteIcon, WalletIcon } from "./icons.tsx";
import { Mascot, type Mood } from "./Mascot.tsx";

type Tone = "gold" | "mind" | "trust" | "betray" | "sky";

export interface GuideStep {
  art: ReactNode;
  text: string;
}

const Tile = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`g-tile ${tone}`}>{children}</span>;

const Badge = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`g-badge ${tone}`}>{children}</span>;

function Face({ id, mood, badge }: { id: string; mood?: Mood; badge?: ReactNode }) {
  return (
    <span className="g-face">
      <Mascot id={id} size={42} mood={mood} />
      {badge}
    </span>
  );
}

function Duo({ a, b, am, bm, badge }: { a: string; b: string; am?: Mood; bm?: Mood; badge?: ReactNode }) {
  return (
    <span className="g-duo">
      <Mascot id={a} size={34} mood={am} />
      <Mascot id={b} size={34} mood={bm} />
      {badge}
    </span>
  );
}

const Trio = () => (
  <span className="g-trio">
    <Mascot id="saint" size={28} />
    <Mascot id="snake" size={34} mood="trust" />
    <Mascot id="mirror" size={28} />
  </span>
);

const Cards = ({ open }: { open?: boolean }) => (
  <span className="g-cards">
    {open ? (
      <>
        <span className="g-card t">
          <TrustIcon size={18} />
        </span>
        <span className="g-card b">
          <BetrayIcon size={18} />
        </span>
      </>
    ) : (
      <>
        <span className="g-card">?</span>
        <span className="g-card">?</span>
      </>
    )}
  </span>
);

/** A one-line picture strip that shows what to do on this part of the site. */
export function Guide({ steps, compact = false, label = "How it works" }: { steps: GuideStep[]; compact?: boolean; label?: string }) {
  return (
    <div className={`guide ${compact ? "compact" : ""}`} aria-label={label} role="list">
      <div className="guide-row">
        {steps.map((s, i) => (
          <Fragment key={s.text}>
            {i > 0 && (
              <span className="guide-arrow" aria-hidden>
                <ArrowIcon size={compact ? 13 : 15} />
              </span>
            )}
            <motion.div
              className="guide-step"
              role="listitem"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + i * 0.07, type: "spring", stiffness: 320, damping: 26 }}
            >
              <motion.span className="guide-art" whileHover={{ y: -3, rotate: -4, scale: 1.06 }} transition={{ type: "spring", stiffness: 400, damping: 14 }}>
                {s.art}
              </motion.span>
              <span className="guide-text">{s.text}</span>
            </motion.div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export const LaunchGuide = ({ coin }: { coin: string }) => (
  <Guide
    steps={[
      { art: <Trio />, text: "Pick a personality" },
      {
        art: (
          <Tile tone="sky">
            <ShuffleIcon size={24} />
          </Tile>
        ),
        text: "Design its face",
      },
      {
        art: (
          <Tile tone="gold">
            <BlocksIcon size={24} />
          </Tile>
        ),
        text: "Tap together its rules",
      },
      {
        art: (
          <Face
            id={coin}
            mood="win"
            badge={
              <Badge tone="gold">
                <CoinIcon size={14} />
              </Badge>
            }
          />
        ),
        text: "Watch it fight live",
      },
    ]}
  />
);

export const RulesGuide = ({ coin }: { coin: string }) => (
  <Guide
    compact
    label="How the rules work"
    steps={[
      {
        art: (
          <Tile tone="gold">
            <BlocksIcon size={22} />
          </Tile>
        ),
        text: "Tap blocks",
      },
      {
        art: (
          <Tile tone="sky">
            <PenIcon size={22} />
          </Tile>
        ),
        text: "They write its rules",
      },
      {
        art: (
          <Face
            id={coin}
            mood="thinking"
            badge={
              <Badge tone="mind">
                <BrainIcon size={14} />
              </Badge>
            }
          />
        ),
        text: "Its AI follows them",
      },
    ]}
  />
);

export const MineGuide = ({ coin }: { coin: string }) => (
  <Guide
    compact
    label="Your coins"
    steps={[
      {
        art: (
          <Tile tone="mind">
            <WalletIcon size={22} />
          </Tile>
        ),
        text: "Kept in this browser",
      },
      { art: <Face id={coin} mood="win" />, text: "Coins you made or hold" },
      {
        art: (
          <Duo
            a={coin}
            b="snake"
            am="thinking"
            bm="thinking"
            badge={
              <Badge tone="gold">
                <ClockIcon size={14} />
              </Badge>
            }
          />
        ),
        text: "Their next matches",
      },
    ]}
  />
);

export const TradeGuide = ({ coin }: { coin: string }) => (
  <Guide
    compact
    steps={[
      {
        art: (
          <Tile tone="gold">
            <CoinIcon size={22} />
          </Tile>
        ),
        text: "Buy shares",
      },
      {
        art: (
          <Tile tone="mind">
            <ClockIcon size={22} />
          </Tile>
        ),
        text: "Fills after its next match",
      },
      {
        art: (
          <Face
            id={coin}
            mood="win"
            badge={
              <Badge tone="trust">
                <ChartIcon size={14} />
              </Badge>
            }
          />
        ),
        text: "Price moves with each match",
      },
      {
        art: (
          <Tile tone="sky">
            <WalletIcon size={22} />
          </Tile>
        ),
        text: "Sell anytime",
      },
    ]}
  />
);

export const VoteGuide = ({ coin, practice }: { coin: string; practice: boolean }) => (
  <Guide
    compact
    steps={[
      {
        art: (
          <Tile tone="gold">
            <PenIcon size={22} />
          </Tile>
        ),
        text: "Propose new rules",
      },
      {
        art: (
          <Tile tone="trust">
            <VoteIcon size={22} />
          </Tile>
        ),
        text: "Holders vote",
      },
      {
        art: (
          <Tile tone="mind">
            <ClockIcon size={22} />
          </Tile>
        ),
        text: "A short wait",
      },
      {
        art: (
          <Face
            id={coin}
            mood="thinking"
            badge={
              <Badge tone="mind">
                <BrainIcon size={14} />
              </Badge>
            }
          />
        ),
        text: practice ? "New rules are saved" : "Its AI follows them",
      },
    ]}
  />
);

export const MatchGuide = () => (
  <Guide
    steps={[
      {
        art: (
          <Duo
            a="saint"
            b="snake"
            badge={
              <Badge tone="mind">
                <ChatIcon size={14} />
              </Badge>
            }
          />
        ),
        text: "Two coins chat",
      },
      { art: <Cards />, text: "Each picks in secret" },
      { art: <Cards open />, text: "Both cards flip" },
      {
        art: (
          <Duo
            a="snake"
            b="saint"
            am="win"
            bm="lose"
            badge={
              <Badge tone="gold">
                <CoinIcon size={14} />
              </Badge>
            }
          />
        ),
        text: "The money moves",
      },
    ]}
  />
);

export const ProofGuide = () => (
  <Guide
    steps={[
      {
        art: (
          <Tile tone="gold">
            <AskIcon size={24} />
          </Tile>
        ),
        text: "The chain writes the question",
      },
      {
        art: (
          <Tile tone="mind">
            <ChipIcon size={24} />
          </Tile>
        ),
        text: "Sealed hardware signs the answer",
      },
      {
        art: (
          <Tile tone="trust">
            <ShieldCheckIcon size={26} />
          </Tile>
        ),
        text: "The contract checks the stamp",
      },
    ]}
  />
);

export const WalletGuide = () => (
  <Guide
    compact
    steps={[
      {
        art: (
          <Tile tone="mind">
            <WalletIcon size={22} />
          </Tile>
        ),
        text: "Free play wallet",
      },
      { art: <Face id="saint" mood="win" />, text: "No sign-up" },
      {
        art: (
          <Tile tone="gold">
            <CoinIcon size={22} />
          </Tile>
        ),
        text: "Test NEAR only",
      },
    ]}
  />
);

export const CoinsGuide = () => (
  <Guide
    steps={[
      { art: <Trio />, text: "Pick a coin you like" },
      {
        art: (
          <Tile tone="gold">
            <CoinIcon size={24} />
          </Tile>
        ),
        text: "Buy its shares",
      },
      {
        art: (
          <Duo
            a="diplomat"
            b="skeptic"
            am="win"
            bm="lose"
            badge={
              <Badge tone="trust">
                <ChartIcon size={14} />
              </Badge>
            }
          />
        ),
        text: "Its price moves every match",
      },
    ]}
  />
);
