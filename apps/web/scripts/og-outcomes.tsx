// Writes the three 1200x630 match previews as HTML, one per outcome. Render each with headless Chrome:
//   bun scripts/og-outcomes.tsx /tmp/og
//   for k in trust betray both-betray; do "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
//     --hide-scrollbars --window-size=1200,630 --screenshot=public/og/$k.png file:///tmp/og/$k.html; done
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Mark } from "../src/components/Mark.tsx";
import { Mascot, type Mood } from "../src/components/Mascot.tsx";
import { BetrayIcon, TrustIcon } from "../src/components/icons.tsx";

const dir = process.argv[2] ?? "/tmp/parley-og";
const fonts = join(import.meta.dir, "../../../node_modules/@fontsource-variable");
const font = (family: string, file: string) =>
  `@font-face{font-family:"${family}";src:url("file://${fonts}/${file}") format("woff2-variations");font-weight:100 900;font-display:block}`;

type Move = "trust" | "betray";
interface Side {
  id: string;
  mood: Mood;
  move: Move;
  result: string;
  up: boolean;
}
interface Outcome {
  key: string;
  head: [string, string];
  tone: string;
  glow: [string, string];
  a: Side;
  b: Side;
  coins: "pot-to-both" | "b-to-a" | "both-to-pot";
}

const OUTCOMES: Outcome[] = [
  {
    key: "trust",
    head: ["Both trusted.", "Both got paid."],
    tone: "linear-gradient(100deg,#34d399 0%,#b6f0d7 60%,#ffc857 100%)",
    glow: ["#ffc857", "#7aa7ff"],
    a: { id: "saint", mood: "trust", move: "trust", result: "+ bonus", up: true },
    b: { id: "mirror", mood: "trust", move: "trust", result: "+ bonus", up: true },
    coins: "pot-to-both",
  },
  {
    key: "betray",
    head: ["One trusted.", "One betrayed."],
    tone: "linear-gradient(100deg,#ffc857 0%,#ff9f43 45%,#ff5468 100%)",
    glow: ["#3ddc84", "#ffc857"],
    a: { id: "snake", mood: "betray", move: "betray", result: "takes the stake", up: true },
    b: { id: "saint", mood: "lose", move: "trust", result: "loses it", up: false },
    coins: "b-to-a",
  },
  {
    key: "both-betray",
    head: ["Both betrayed.", "Nobody won."],
    tone: "linear-gradient(100deg,#ff9f43 0%,#ff5468 70%,#ff4d5e 100%)",
    glow: ["#3ddc84", "#ff4d5e"],
    a: { id: "snake", mood: "lose", move: "betray", result: "pays the pot", up: false },
    b: { id: "grudge", mood: "lose", move: "betray", result: "pays the pot", up: false },
    coins: "both-to-pot",
  },
];

const card = (move: Move) => (
  <div className={`card ${move}`}>
    {move === "trust" ? <TrustIcon size={28} /> : <BetrayIcon size={28} />}
    <span>{move === "trust" ? "Trust" : "Betray"}</span>
  </div>
);

const COIN_PATHS: Record<Outcome["coins"], [number, number][]> = {
  "pot-to-both": [
    [182, 124],
    [146, 100],
    [218, 100],
    [110, 124],
    [254, 124],
  ],
  "b-to-a": [
    [256, 142],
    [218, 112],
    [178, 100],
    [138, 108],
    [102, 132],
  ],
  "both-to-pot": [
    [201, 508],
    [172, 486],
    [230, 486],
    [146, 462],
    [256, 462],
  ],
};

function page(o: Outcome): string {
  const body = renderToStaticMarkup(
    <div className="og">
      <div className="left">
        <div className="brand">
          <Mark />
          <span>Parley</span>
        </div>
        <h1>
          {o.head[0]}
          <br />
          <span className="grad">{o.head[1]}</span>
        </h1>
        <p>
          Two AI coins talked, then picked in secret.
          <br />
          NEAR checked every signed reply before money moved.
        </p>
      </div>
      <div className="right">
        <div className="glow a" style={{ background: o.glow[0] }} />
        <div className="glow b" style={{ background: o.glow[1] }} />
        {COIN_PATHS[o.coins].map(([x, y], i) => (
          <span key={i} className="coin-dot" style={{ left: x, top: y, transform: `scale(${1 - i * 0.07})` }} />
        ))}
        {o.coins === "both-to-pot" && <div className="pot">The pot</div>}
        {[o.a, o.b].map((s, i) => (
          <div key={s.id} className={`fighter ${i ? "b" : "a"}`}>
            <Mascot id={s.id} size={196} mood={s.mood} />
            {card(s.move)}
            <span className={`result ${s.up ? "up" : "down"}`}>{s.result}</span>
          </div>
        ))}
      </div>
    </div>,
  );
  const css = `
${font("Bricolage", "bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2")}
${font("Inter", "inter/files/inter-latin-wght-normal.woff2")}
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:630px;overflow:hidden;background:#0a0b0f;color:#f2f0ea;-webkit-font-smoothing:antialiased}
.og{position:relative;width:1200px;height:630px;display:grid;grid-template-columns:660px 1fr;align-items:center;padding:0 0 0 72px;
  background:radial-gradient(700px 420px at 8% -10%,rgba(124,92,255,.16),transparent 65%),radial-gradient(640px 420px at 100% 110%,rgba(52,211,153,.08),transparent 65%),#0a0b0f}
.brand{display:flex;align-items:center;gap:16px;font:800 44px/1 Bricolage;letter-spacing:-.02em;margin-bottom:30px}
.brand svg{width:64px;height:64px}
h1{font:800 70px/1.02 Bricolage;letter-spacing:-.035em;white-space:nowrap}
.grad{background:${o.tone};-webkit-background-clip:text;background-clip:text;color:transparent}
p{margin-top:26px;font:500 23px/1.45 Inter;color:#a0a7b4;white-space:nowrap}
.right{position:relative;height:630px}
.glow{position:absolute;width:250px;height:250px;border-radius:50%;filter:blur(64px);opacity:.26}
.glow.a{left:-10px;top:200px}
.glow.b{left:220px;top:200px}
.fighter{position:absolute;top:170px;display:grid;justify-items:center;gap:6px}
.fighter.a{left:-40px}
.fighter.b{left:204px}
.card{margin-top:-4px;display:flex;align-items:center;gap:8px;padding:9px 16px;border-radius:16px;font:800 21px/1 Bricolage;letter-spacing:.02em;text-transform:uppercase}
.card.trust{color:#34d399;background:rgba(52,211,153,.16)}
.card.betray{color:#ff5468;background:rgba(255,84,104,.16)}
.result{font:600 17px/1 Inter;color:#a0a7b4}
.result.up{color:#ffc857}
.coin-dot{position:absolute;width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff3c4,#ffc857 45%,#b8860b);box-shadow:0 3px 8px rgba(0,0,0,.45)}
.pot{position:absolute;left:150px;top:546px;width:128px;padding:8px 0;border-radius:999px;text-align:center;font:700 15px/1 Inter;color:#ffc857;background:rgba(255,200,87,.12)}
`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}

mkdirSync(dir, { recursive: true });
for (const o of OUTCOMES) writeFileSync(join(dir, `${o.key}.html`), page(o));
console.log(`og html: ${OUTCOMES.map((o) => join(dir, `${o.key}.html`)).join(", ")}`);
