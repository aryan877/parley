import type { SignedReply } from "@parley/sdk";

/** Something that answers a turn request and returns the enclave-signed reply. */
export interface Mind {
  readonly name: string;
  reply(model: string, request: string): Promise<SignedReply>;
}

export interface ChatRequest {
  model: string;
  messages: { role: string; content: string }[];
  seed: number;
  max_tokens: number;
}

export function completionBody(model: string, content: string, id: string): string {
  return JSON.stringify({
    id,
    object: "chat.completion",
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  });
}
