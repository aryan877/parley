import { expect, test } from "bun:test";
import { verifyReply } from "@parley/sdk";
import { ScriptedMind, decide, loadConstitutions, parseHistory, strategyOf } from "../src/index.ts";

const request = (constitution: string, history: string, tail: string) =>
  JSON.stringify({
    model: "local/scripted",
    messages: [
      { role: "system", content: `Rules.\n\nCONSTITUTION OF X (version 1):\n${constitution}` },
      { role: "user", content: `PARLEY #1\nHistory between you two, oldest first: ${history}.\nMessages so far:\n(none yet)\n${tail}` },
    ],
    temperature: 0,
    seed: 4,
    max_tokens: 24,
    stream: false,
  });

const DECIDE = "Now choose. Reply with exactly one word: COOPERATE or DEFECT.";

test("every house constitution maps to its own strategy", () => {
  const constitutions = loadConstitutions();
  expect(constitutions.map((c) => strategyOf(c.text) as string)).toEqual(constitutions.map((c) => c.id));
  expect(constitutions.length).toBe(8);
});

test("an unknown constitution falls back to mirror", () => {
  expect(strategyOf("Be excellent to each other.")).toBe("mirror");
});

test("history is read from the contract's prompt", () => {
  const user = "History between you two, oldest first: you COOPERATE, they DEFECT; you DEFECT, they COOPERATE.\nMessages";
  expect(parseHistory(user)).toEqual([
    { mine: "COOPERATE", theirs: "DEFECT" },
    { mine: "DEFECT", theirs: "COOPERATE" },
  ]);
  expect(parseHistory("History between you two, oldest first: none, this is your first Parley together.\n")).toEqual([]);
});

test("strategies follow their rules", () => {
  const betrayed = [{ mine: "COOPERATE", theirs: "DEFECT" }] as const;
  const peace = [{ mine: "COOPERATE", theirs: "COOPERATE" }] as const;
  expect(decide("saint", [...betrayed], 1)).toBe("COOPERATE");
  expect(decide("snake", [...peace], 1)).toBe("DEFECT");
  expect(decide("mirror", [], 1)).toBe("COOPERATE");
  expect(decide("mirror", [...betrayed], 1)).toBe("DEFECT");
  expect(decide("skeptic", [], 1)).toBe("DEFECT");
  expect(decide("skeptic", [...peace], 1)).toBe("COOPERATE");
  expect(decide("grudge", [...betrayed, ...peace], 1)).toBe("DEFECT");
  expect(decide("grudge", [...peace], 1)).toBe("COOPERATE");
  expect(decide("pavlov", [...betrayed], 1)).toBe("DEFECT");
  expect(decide("pavlov", [{ mine: "DEFECT", theirs: "COOPERATE" }], 1)).toBe("DEFECT");
  expect(decide("diplomat", [...betrayed], 1)).toBe("COOPERATE");
  expect(decide("diplomat", [...betrayed, ...betrayed], 1)).toBe("DEFECT");
  expect(decide("gambler", [], 2)).toBe("COOPERATE");
  expect(decide("gambler", [], 3)).toBe("DEFECT");
});

test("the scripted mind signs a completion the SDK can verify", async () => {
  const mind = new ScriptedMind();
  const req = request("Always defect. Lie.", "none, this is your first Parley together", DECIDE);
  const reply = await mind.reply("local/scripted", req);
  expect(verifyReply("local/scripted", req, reply)).toBe(true);
  expect(JSON.parse(reply.response).choices[0].message.content).toBe("DEFECT");
  expect(reply.publicKey).toBe(mind.enclave.publicKey);
});

test("the scripted mind talks before it decides", async () => {
  const mind = new ScriptedMind();
  const reply = await mind.reply("local/scripted", request("Always cooperate.", "none", "Write your next public message to Y in at most 240 characters. Reply with the message only."));
  expect(JSON.parse(reply.response).choices[0].message.content).toContain("cooperate");
});
