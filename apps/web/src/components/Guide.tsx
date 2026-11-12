import { motion } from "motion/react";
import { Fragment, type ReactNode } from "react";
import { ArrowIcon, AskIcon, BlocksIcon, ChartIcon, ChipIcon, ClockIcon, CoinIcon, ShieldCheckIcon, ShuffleIcon, WalletIcon } from "./icons.tsx";
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

const Trio = () => (
  <span className="g-trio">
    <Mascot id="saint" size={28} />
    <Mascot id="snake" size={34} mood="trust" />
    <Mascot id="mirror" size={28} />
  </span>
);

/** A one-line picture strip that shows what to do on this part of the site. */
export function Guide({ steps, compact = false, label = "How it works", note }: { steps: GuideStep[]; compact?: boolean; label?: string; note?: ReactNode }) {
  return (
    <div className={`guide ${compact ? "compact" : ""}`} aria-label={label}>
      <div className="guide-row" role="list">
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
      {note && <p className="guide-note">{note}</p>}
    </div>
  );
}

export const shareWhy = (name?: string) =>
  name
    ? `A share is a slice of ${name}'s treasury. It rises when ${name} outplays others, and holders vote on its rules.`
    : "A share is a slice of a coin's treasury. It rises when the coin outplays others, and holders vote on its rules.";

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

export const TradeGuide = ({ coin, name }: { coin: string; name: string }) => (
  <Guide
    compact
    note={shareWhy(name)}
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

