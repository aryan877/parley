import { type ModelInput, sha256Hex, verifyTdxQuote } from "@parley/sdk";
import { profile } from "./models.ts";

/** What NEAR AI Cloud publishes about one model enclave, trimmed to the parts that can be re-checked offline. */
export interface Attestation {
  model: string;
  publicKey: string;
  nonceText: string;
  quote: string;
  source: string;
  fetchedAt: string;
  platform: Record<string, string>;
}

export const quoteEvidence = (quote: string) => `tdx-quote-sha256:${sha256Hex(quote)}`;

interface Report {
  model_attestations?: {
    signing_address?: string;
    signing_algo?: string;
    intel_quote?: string;
    info?: Record<string, unknown>;
  }[];
}

/** Asks the model's enclave for a fresh Intel TDX quote that names its signing key and our nonce. Needs no API key. */
export async function fetchAttestation(model: string, nonceText: string, baseUrl = "https://cloud-api.near.ai/v1"): Promise<Attestation> {
  const nonce = sha256Hex(nonceText);
  const source = `${baseUrl}/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ed25519&nonce=${nonce}`;
  const res = await fetch(source);
  if (!res.ok) throw new Error(`attestation for ${model} failed (${res.status})`);
  const entry = ((await res.json()) as Report).model_attestations?.[0];
  const publicKey = (entry?.signing_address ?? "").replace(/^0x/, "").toLowerCase();
  const quote = entry?.intel_quote ?? "";
  const check = verifyTdxQuote(quote);
  if (!check.ok) throw new Error(`attestation for ${model} does not verify: ${check.problems.join("; ")}`);
  if (check.quote?.reportData !== publicKey + nonce) throw new Error(`the quote for ${model} does not name this key and nonce`);
  const info = entry?.info ?? {};
  const platform = Object.fromEntries(
    ["app_id", "compose_hash", "os_image_hash", "mr_aggregated"].flatMap((k) => (typeof info[k] === "string" ? [[k, info[k] as string]] : [])),
  );
  return { model, publicKey, nonceText, quote, source, fetchedAt: new Date().toISOString(), platform };
}

export function attestedModel(attestation: Attestation): ModelInput {
  return { ...profile(attestation.model), signers: [{ public_key: attestation.publicKey, evidence: quoteEvidence(attestation.quote) }] };
}
