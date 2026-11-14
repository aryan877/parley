// Writes the 1200x630 link preview as HTML. Render it with headless Chrome:
//   bun scripts/og.tsx /tmp/og.html
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
//     --window-size=1200,630 --screenshot=public/og.png file:///tmp/og.html
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Mark } from "../src/components/Mark.tsx";
import { Mascot } from "../src/components/Mascot.tsx";
import { BetrayIcon, TrustIcon } from "../src/components/icons.tsx";

const out = process.argv[2] ?? "/tmp/parley-og.html";
const fonts = join(import.meta.dir, "../../../node_modules/@fontsource-variable");
const font = (family: string, file: string) =>
  `@font-face{font-family:"${family}";src:url("file://${fonts}/${file}") format("woff2-variations");font-weight:100 900;font-display:block}`;

const card = (move: "trust" | "betray") => (
  <div className={`card ${move}`}>
    {move === "trust" ? <TrustIcon size={30} /> : <BetrayIcon size={30} />}
    <span>{move === "trust" ? "Trust" : "Betray"}</span>
  </div>
);

const body = renderToStaticMarkup(
  <div className="og">
    <div className="left">
      <div className="brand">
        <Mark />
        <span>Parley</span>
      </div>
      <h1>
        Memecoins
        <br />
        <span className="grad">that can lie.</span>
      </h1>
      <p>
        AI coins chat, then pick Trust or Betray blind.
        <br />
        NEAR checks every signed reply before money moves.
      </p>
    </div>
    <div className="right">
      <div className="glow a" />
      <div className="glow b" />
      <div className="coin back">
        <Mascot id="gambler" size={140} mood="win" />
      </div>
      <div className="coin saint">
        <Mascot id="saint" size={214} mood="trust" />
        {card("trust")}
      </div>
      <div className="coin snake">
        <Mascot id="snake" size={214} mood="betray" />
        {card("betray")}
      </div>
    </div>
  </div>,
);

const css = `
${font("Bricolage", "bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2")}
${font("Inter", "inter/files/inter-latin-wght-normal.woff2")}
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:630px;overflow:hidden;background:#0a0b0f;color:#f2f0ea;-webkit-font-smoothing:antialiased}
.og{position:relative;width:1200px;height:630px;display:grid;grid-template-columns:690px 1fr;align-items:center;padding:0 0 0 72px;
  background:radial-gradient(700px 420px at 8% -10%,rgba(124,92,255,.16),transparent 65%),radial-gradient(640px 420px at 100% 110%,rgba(52,211,153,.10),transparent 65%),#0a0b0f}
.brand{display:flex;align-items:center;gap:16px;font:800 44px/1 Bricolage;letter-spacing:-.02em;margin-bottom:30px}
.brand svg{width:64px;height:64px}
h1{font:800 68px/1 Bricolage;letter-spacing:-.035em;white-space:nowrap}
.grad{background:linear-gradient(100deg,#34d399 0%,#b6f0d7 32%,#ffc857 58%,#ff5468 92%);-webkit-background-clip:text;background-clip:text;color:transparent}
p{margin-top:26px;font:500 23px/1.45 Inter;color:#a0a7b4;white-space:nowrap}
.right{position:relative;height:630px}
.glow{position:absolute;border-radius:50%;filter:blur(60px);opacity:.28}
.glow.a{width:260px;height:260px;left:0;top:254px;background:#ffc857}
.glow.b{width:260px;height:260px;left:190px;top:214px;background:#3ddc84}
.coin{position:absolute;display:grid;justify-items:center}
.coin.back{left:138px;top:96px}
.coin.saint{left:-14px;top:228px}
.coin.snake{left:200px;top:200px}
.card{margin-top:-6px;display:flex;align-items:center;gap:8px;padding:10px 18px;border-radius:16px;font:800 22px/1 Bricolage;letter-spacing:.02em;text-transform:uppercase}
.card.trust{color:#34d399;background:rgba(52,211,153,.16)}
.card.betray{color:#ff5468;background:rgba(255,84,104,.16)}
`;

writeFileSync(out, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`);
console.log(`og html: ${out}`);
