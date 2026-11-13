const LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

export interface Series {
  label: string;
  values: number[];
  muted?: boolean;
}

export interface Marker {
  x: number;
  label: string;
}

export interface Chart {
  title: string;
  subtitle: string;
  unit: string;
  series: Series[];
  markers?: Marker[];
  reference?: { y: number; label: string };
}

const W = 760;
const H = 396;
const LEFT = 56;
const RIGHT = 196;
const TOP = 84;
const BOTTOM = 44;

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (n: number) => (Math.round(n * 1000) / 1000).toString();

function step(range: number, count: number): number {
  const raw = range / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

export function lineChart(chart: Chart): string {
  if (chart.series.filter((s) => !s.muted).length > LIGHT.length) throw new Error(`${chart.title}: more than ${LIGHT.length} colored series`);
  const days = Math.max(...chart.series.map((s) => s.values.length)) - 1;
  const finite = chart.series.flatMap((s) => s.values.filter(Number.isFinite));
  const top = Math.max(...finite, chart.reference?.y ?? 0, 0.001);
  const tick = step(top, 5);
  const yMax = Math.ceil(top / tick) * tick;
  const plotW = W - LEFT - RIGHT;
  const plotH = H - TOP - BOTTOM;
  const x = (day: number) => LEFT + (day / days) * plotW;
  const y = (v: number) => TOP + plotH - (v / yMax) * plotH;

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escape(chart.title)}">`);
  out.push("<style>");
  out.push(
    ".bg{fill:#fcfcfb}.t{fill:#0b0b0b;font:600 15px system-ui,-apple-system,'Segoe UI',sans-serif}.st{fill:#52514e;font:12px system-ui,-apple-system,'Segoe UI',sans-serif}" +
      ".ax{fill:#898781;font:11px system-ui,-apple-system,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums}.lg{fill:#0b0b0b;font:12px system-ui,-apple-system,'Segoe UI',sans-serif}" +
      ".lv{fill:#52514e;font:12px system-ui,-apple-system,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums}.grid{stroke:#e1e0d9;stroke-width:1}.base{stroke:#c3c2b7;stroke-width:1}" +
      ".ref{stroke:#898781;stroke-width:1}.line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.dot{stroke:#fcfcfb;stroke-width:2}.muted{stroke:#898781;fill:#898781}",
  );
  out.push(LIGHT.map((c, i) => `.s${i + 1}{stroke:${c};fill:${c}}`).join(""));
  out.push(
    "@media (prefers-color-scheme:dark){.bg{fill:#1a1a19}.t,.lg{fill:#f0efec}.st,.lv{fill:#c3c2b7}.grid{stroke:#2c2c2a}.base{stroke:#383835}.dot{stroke:#1a1a19}" +
      DARK.map((c, i) => `.s${i + 1}{stroke:${c};fill:${c}}`).join("") +
      "}",
  );
  out.push("</style>");
  out.push(`<rect class="bg" width="${W}" height="${H}" rx="8"/>`);
  out.push(`<text class="t" x="16" y="26">${escape(chart.title)}</text>`);
  out.push(`<text class="st" x="16" y="46">${escape(chart.subtitle)}</text>`);

  for (let v = 0; v <= yMax + tick / 2; v += tick) {
    const py = y(v);
    out.push(`<line class="${v === 0 ? "base" : "grid"}" x1="${LEFT}" x2="${LEFT + plotW}" y1="${num(py)}" y2="${num(py)}"/>`);
    out.push(`<text class="ax" x="${LEFT - 8}" y="${num(py + 4)}" text-anchor="end">${num(v)}</text>`);
  }
  for (let d = 0; d <= days; d += 10) {
    out.push(`<text class="ax" x="${num(x(d))}" y="${H - BOTTOM + 18}" text-anchor="middle">${d}</text>`);
  }
  out.push(`<text class="ax" x="${LEFT + plotW}" y="${H - 8}" text-anchor="end">day</text>`);
  out.push(`<text class="ax" x="${LEFT - 8}" y="${TOP - 16}" text-anchor="end">${escape(chart.unit)}</text>`);
  if (chart.reference) {
    const py = num(y(chart.reference.y));
    out.push(`<line class="ref" x1="${LEFT}" x2="${LEFT + plotW}" y1="${py}" y2="${py}"/>`);
    out.push(`<text class="ax" x="${LEFT + plotW - 4}" y="${num(y(chart.reference.y) - 4)}" text-anchor="end">${escape(chart.reference.label)}</text>`);
  }
  for (const m of chart.markers ?? []) {
    const px = num(x(m.x));
    out.push(`<line class="ref" x1="${px}" x2="${px}" y1="${TOP - 4}" y2="${TOP + plotH}"/>`);
    out.push(`<text class="ax" x="${num(x(m.x) + 4)}" y="${TOP - 6}">${escape(m.label)}</text>`);
  }

  let colored = 0;
  const drawn = chart.series.map((s) => ({ ...s, cls: s.muted ? "muted" : `s${++colored}` }));
  for (const s of drawn) {
    let path = "";
    let pen = false;
    s.values.forEach((v, day) => {
      if (!Number.isFinite(v)) {
        pen = false;
        return;
      }
      path += `${pen ? "L" : "M"}${num(x(day))} ${num(y(v))}`;
      pen = true;
    });
    const lastDay = s.values.length - 1;
    const last = s.values[lastDay] ?? Number.NaN;
    out.push(`<g><title>${escape(s.label)}: ${Number.isFinite(last) ? last.toFixed(3) : "none"} on day ${lastDay}</title>`);
    out.push(`<path class="line ${s.cls}" style="fill:none" d="${path}"/>`);
    if (Number.isFinite(last)) out.push(`<circle class="dot ${s.cls}" cx="${num(x(lastDay))}" cy="${num(y(last))}" r="4"/>`);
    out.push("</g>");
  }

  const legend = [...drawn].sort((a, b) => (b.values.at(-1) ?? -Infinity) - (a.values.at(-1) ?? -Infinity));
  const legendX = LEFT + plotW + 24;
  legend.forEach((s, i) => {
    const ly = TOP + 6 + i * 20;
    const last = s.values.at(-1) ?? Number.NaN;
    out.push(`<line class="line ${s.cls}" x1="${legendX}" x2="${legendX + 16}" y1="${ly}" y2="${ly}"/>`);
    out.push(`<text class="lg" x="${legendX + 22}" y="${ly + 4}">${escape(s.label)}</text>`);
    out.push(`<text class="lv" x="${W - 12}" y="${ly + 4}" text-anchor="end">${Number.isFinite(last) ? last.toFixed(2) : ""}</text>`);
  });
  out.push("</svg>");
  return `${out.join("\n")}\n`;
}
