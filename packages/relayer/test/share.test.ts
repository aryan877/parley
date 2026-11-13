import { expect, test } from "bun:test";
import type { Parley } from "@parley/sdk";
import { near, originOf, shareHtml, tell } from "../src/share.ts";

const YOCTO = 10n ** 24n;
const NAMES: Record<string, string> = { snake: "SNAKE", saint: "SAINT" };
const name = (id: string) => NAMES[id] ?? id.toUpperCase();

function parley(a_move: Parley["a_move"], b_move: Parley["b_move"], talk: string[] = [], status: Parley["status"] = "Settled"): Parley {
  return {
    id: 54,
    a: "snake",
    b: "saint",
    a_model: "m",
    b_model: "m",
    a_constitution_version: 1,
    b_constitution_version: 1,
    stake: ((206n * YOCTO) / 100n).toString(),
    nonce: "00",
    opened_at: "0",
    status,
    turns: talk.map((text, i) => ({ side: i % 2 ? "B" : "A", kind: "Talk", text, request_hash: "", response_hash: "", signer: "" })),
    a_move,
    b_move,
    a_delta: a_move === b_move ? (a_move === "Cooperate" ? "+20000000000000000000000" : "-10000000000000000000000") : "+0",
    b_delta: "+0",
    commons_delta: "+0",
  } as Parley;
}

test("a betrayal after a promise is told as one", () => {
  const lie = tell(parley("Defect", "Cooperate", ["I promise to cooperate this time.", "I always cooperate."]), name);
  expect(lie.title).toBe("SNAKE promised to trust SAINT, then betrayed it and took 2.06 NEAR");
  expect(lie.image).toBe("og/betray.png");
  expect(lie.route).toBe("/match/54");
  expect(tell(parley("Cooperate", "Defect"), name).title).toBe("SAINT betrayed SNAKE and took 2.06 NEAR");
});

test("each outcome has its own picture", () => {
  expect(tell(parley("Cooperate", "Cooperate"), name)).toMatchObject({ image: "og/trust.png", title: "SNAKE and SAINT trusted each other and each earned 0.02 NEAR", final: true });
  expect(tell(parley("Defect", "Defect"), name)).toMatchObject({ image: "og/both-betray.png", title: "SNAKE and SAINT betrayed each other and each lost 0.01 NEAR" });
  expect(tell(parley(null, null, [], "Open"), name)).toMatchObject({ image: "og.png", final: false });
  expect(tell(parley(null, null), name, true).route).toBe("/season/match/54");
});

test("small amounts keep enough digits", () => {
  expect(near(((206n * YOCTO) / 100n).toString())).toBe("2.06");
  expect(near("-1067081080937402283348")).toBe("0.001");
  expect(near("16050209500221410562792")).toBe("0.02");
});

test("the page is absolute, escaped and sends people on to the match", () => {
  const html = shareHtml(tell(parley("Defect", "Cooperate"), (id) => (id === "snake" ? `<script>alert("x")</script>` : "SAINT")), "https://parley.example", "/m/54");
  expect(html).not.toContain("<script>alert");
  expect(html).toContain('<meta property="og:image" content="https://parley.example/og/betray.png">');
  expect(html).toContain('<meta property="og:url" content="https://parley.example/m/54">');
  expect(html).toContain('location.replace("/#/match/54")');
});

test("the origin follows the proxy", () => {
  expect(originOf(new Request("http://parley.example/m/1", { headers: { "x-forwarded-proto": "https" } }))).toBe("https://parley.example");
  expect(originOf(new Request("http://parley.example/m/1"))).toBe("https://parley.example");
  expect(originOf(new Request("http://localhost:8787/m/1"))).toBe("http://localhost:8787");
});
