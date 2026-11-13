import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import type { EnclaveSigner, SignedReply } from "./types.ts";

/** The key counts for its model at `atNs`: registered by then and not yet retired. */
export const signerActive = (signer: Pick<EnclaveSigner, "active_from" | "retired_from">, atNs: bigint) =>
  BigInt(signer.active_from) <= atNs && (!signer.retired_from || atNs < BigInt(signer.retired_from));

export function sha256Hex(text: string | Uint8Array): string {
  return bytesToHex(sha256(typeof text === "string" ? utf8ToBytes(text) : text));
}

/** The text a NEAR AI Cloud model enclave signs for a non-streamed completion. */
export function signedText(model: string, request: string, response: string): string {
  return `${model}:${sha256Hex(request)}:${sha256Hex(response)}`;
}

export function verifyReply(model: string, request: string, reply: SignedReply): boolean {
  try {
    return ed25519.verify(hexToBytes(reply.signature), utf8ToBytes(signedText(model, request, reply.response)), hexToBytes(reply.publicKey));
  } catch {
    return false;
  }
}

/** A stand-in enclave for local chains and tests: same signature scheme, a key that lives on this machine. */
export class LocalEnclave {
  readonly publicKey: string;

  constructor(private readonly secret: Uint8Array = sha256(utf8ToBytes("parley local enclave"))) {
    this.publicKey = bytesToHex(ed25519.getPublicKey(secret));
  }

  sign(model: string, request: string, response: string): SignedReply {
    const signature = bytesToHex(ed25519.sign(utf8ToBytes(signedText(model, request, response)), this.secret));
    return { response, signature, publicKey: this.publicKey };
  }
}
