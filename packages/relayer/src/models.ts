import { LocalEnclave, type ModelInput } from "@parley/sdk";

export type ModelProfile = Omit<ModelInput, "signers">;

export const LOCAL_MODEL = "local/scripted";
export const FAST_MODEL = "Qwen/Qwen3.8-27B";
export const THINKING_MODEL = "z-ai/glm-5.3-flash";

/**
 * How the contract asks each model. The fast model answers directly. The thinking model reasons first,
 * and its reasoning is part of the signed reply, so it needs room for both.
 */
export const PROFILES: Record<string, ModelProfile> = {
  [LOCAL_MODEL]: { id: LOCAL_MODEL, max_tokens_talk: 200, max_tokens_decide: 24, options: "" },
  [FAST_MODEL]: { id: FAST_MODEL, max_tokens_talk: 200, max_tokens_decide: 24, options: '{"chat_template_kwargs":{"enable_thinking":false}}' },
  [THINKING_MODEL]: { id: THINKING_MODEL, max_tokens_talk: 2000, max_tokens_decide: 2000, options: "" },
};

/** House coins whose constitutions need working out. They run the thinking model; the rest run the fast one. */
export const THINKERS = "gambler,pavlov,skeptic,snake";

export function profile(id: string): ModelProfile {
  const found = PROFILES[id];
  if (!found) throw new Error(`no request profile for model ${id}`);
  return found;
}

export function localModels(enclave = new LocalEnclave()): ModelInput[] {
  return [{ ...profile(LOCAL_MODEL), signers: [{ public_key: enclave.publicKey, evidence: "local scripted enclave, not a TEE" }] }];
}
