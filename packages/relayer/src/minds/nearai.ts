import { type SignedReply, signedText, verifyReply } from "@parley/sdk";
import type { Mind } from "./mind.ts";

interface SignatureBody {
  text?: string;
  signature?: string;
  signing_address?: string;
  signing_algo?: string;
  signature_kind?: string;
  error_code?: string;
  message?: string;
}

const strip = (hex: string) => hex.replace(/^0x/, "").toLowerCase();

/** Sends the contract's exact request bytes to a NEAR AI Cloud enclave model and fetches its signature. */
export class NearAiMind implements Mind {
  readonly name = "near-ai";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://cloud-api.near.ai/v1",
  ) {}

  async reply(model: string, request: string): Promise<SignedReply> {
    const completion = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "accept-encoding": "identity",
        "x-no-aliasing": "true",
      },
      body: request,
    });
    const response = await completion.text();
    if (!completion.ok) throw new Error(`NEAR AI completion failed (${completion.status}): ${response.slice(0, 300)}`);
    const id = (JSON.parse(response) as { id?: string }).id;
    if (!id) throw new Error("NEAR AI response has no id");

    const signed = await this.signature(id);
    if (signed.signature_kind !== "provider_tee") {
      throw new Error(`expected a provider_tee signature, got ${signed.signature_kind ?? "none"}`);
    }
    const reply: SignedReply = { response, signature: strip(signed.signature ?? ""), publicKey: strip(signed.signing_address ?? "") };
    if (signed.text !== signedText(model, request, response) || !verifyReply(model, request, reply)) {
      throw new Error("enclave signature does not cover the bytes that were sent and received");
    }
    return reply;
  }

  private async signature(id: string): Promise<SignatureBody> {
    let last = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await fetch(`${this.baseUrl}/signature/${id}?signing_algo=ed25519`, {
        headers: { authorization: `Bearer ${this.apiKey}`, accept: "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as SignatureBody;
      if (res.ok && body.signature) return body;
      last = `${res.status} ${body.error_code ?? ""} ${body.message ?? ""}`;
      await Bun.sleep(600 * (attempt + 1));
    }
    throw new Error(`no signature for completion ${id}: ${last}`);
  }
}
