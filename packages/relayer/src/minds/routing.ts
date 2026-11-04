import type { SignedReply } from "@parley/sdk";
import { LOCAL_MODEL } from "../models.ts";
import type { Mind } from "./mind.ts";
import { NearAiMind } from "./nearai.ts";
import { ScriptedMind } from "./scripted.ts";

/** Sends each request to the mind that serves its model: the rule-based stand-in locally, NEAR AI Cloud for everything else. */
export class RoutingMind implements Mind {
  readonly name = "routing";
  private readonly scripted = new ScriptedMind();
  private nearAi?: NearAiMind;

  reply(model: string, request: string): Promise<SignedReply> {
    if (model === LOCAL_MODEL) return this.scripted.reply(model, request);
    if (!this.nearAi) {
      const key = process.env.NEAR_AI_API_KEY;
      if (!key) throw new Error(`model ${model} needs NEAR_AI_API_KEY in .env`);
      this.nearAi = new NearAiMind(key, process.env.NEAR_AI_BASE_URL);
    }
    return this.nearAi.reply(model, request);
  }
}
