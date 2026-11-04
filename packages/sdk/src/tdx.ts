import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils";

/** Public key of the Intel SGX Root CA, from https://certificates.trustedservices.intel.com/Intel_SGX_Provisioning_Certification_RootCA.pem */
export const INTEL_ROOT_KEY =
  "040ba9c4c0c0c86193a3fe23d6b02cda10a8bbd4e88e48b4458561a36e705525f567918e2edc88e40d860bd0cc4ee26aacc988e505a953558c453f6b0904ae7394";

const HEADER = 48;
const BODY = 584;
const SIGNED = HEADER + BODY;

export interface TdxQuote {
  reportData: string;
  mrtd: string;
  rtmr: [string, string, string, string];
}

export interface QuoteCheck {
  ok: boolean;
  problems: string[];
  quote?: TdxQuote;
}

interface Tlv {
  tag: number;
  start: number;
  end: number;
  from: number;
}

function tlv(der: Uint8Array, at: number): Tlv {
  const tag = der[at]!;
  let length = der[at + 1]!;
  let start = at + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let i = 0; i < count; i++) length = (length << 8) | der[start + i]!;
    start += count;
  }
  if (start + length > der.length) throw new Error("truncated DER");
  return { tag, start, end: start + length, from: at };
}

function children(der: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let at = parent.start; at < parent.end; ) {
    const child = tlv(der, at);
    out.push(child);
    at = child.end;
  }
  return out;
}

interface Certificate {
  signedPart: Uint8Array;
  signature: Uint8Array;
  publicKey: Uint8Array;
}

function certificate(pem: string): Certificate {
  const der = Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const [signedPart, , signature] = children(der, tlv(der, 0));
  if (!signedPart || !signature) throw new Error("not a certificate");
  const fields = children(der, signedPart);
  const key = fields[fields[0]!.tag === 0xa0 ? 6 : 5];
  if (!key) throw new Error("certificate has no public key");
  const bits = children(der, key)[1]!;
  return {
    signedPart: der.subarray(signedPart.from, signedPart.end),
    signature: der.subarray(signature.start + 1, signature.end),
    publicKey: der.subarray(bits.start + 1, bits.end),
  };
}

function signedBy(cert: Certificate, issuerKey: Uint8Array): boolean {
  try {
    return p256.verify(cert.signature, sha256(cert.signedPart), issuerKey, { lowS: false, prehash: false, format: "der" });
  } catch {
    return false;
  }
}

function signedRaw(signature: Uint8Array, message: Uint8Array, key: Uint8Array): boolean {
  try {
    return p256.verify(signature, sha256(message), key, { lowS: false, prehash: false, format: "compact" });
  } catch {
    return false;
  }
}

const u16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u32 = (b: Uint8Array, at: number) => (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0;
const uncompressed = (xy: Uint8Array) => concatBytes(Uint8Array.of(4), xy);

/**
 * Checks an Intel TDX quote offline: the quote is signed by its attestation key, that key is
 * vouched for by an Intel quoting enclave, and the enclave's platform certificate chains to
 * the pinned Intel root. It does not check revocation lists or the platform's patch level.
 */
export function verifyTdxQuote(quoteHex: string): QuoteCheck {
  const problems: string[] = [];
  try {
    const quote = hexToBytes(quoteHex.replace(/^0x/, ""));
    if (quote.length < SIGNED + 4) return { ok: false, problems: ["quote is too short"] };
    if (u16(quote, 0) !== 4) problems.push("not a version 4 quote");
    if (u16(quote, 2) !== 2) problems.push("attestation key is not ECDSA P-256");
    if (u32(quote, 4) !== 0x81) problems.push("not a TDX quote");

    const body = quote.subarray(HEADER, SIGNED);
    const field = (from: number, size: number) => bytesToHex(body.subarray(from, from + size));
    const parsed: TdxQuote = {
      reportData: field(520, 64),
      mrtd: field(136, 48),
      rtmr: [field(328, 48), field(376, 48), field(424, 48), field(472, 48)],
    };

    const auth = quote.subarray(SIGNED + 4, SIGNED + 4 + u32(quote, SIGNED));
    const quoteSignature = auth.subarray(0, 64);
    const attestationKey = auth.subarray(64, 128);
    if (!signedRaw(quoteSignature, quote.subarray(0, SIGNED), uncompressed(attestationKey))) {
      problems.push("quote signature does not verify");
    }

    if (u16(auth, 128) !== 6) throw new Error("no quoting enclave report");
    let at = 134;
    const enclaveReport = auth.subarray(at, (at += 384));
    const enclaveSignature = auth.subarray(at, (at += 64));
    const extra = auth.subarray(at + 2, (at += 2 + u16(auth, at)));
    if (bytesToHex(enclaveReport.subarray(320, 352)) !== bytesToHex(sha256(concatBytes(attestationKey, extra)))) {
      problems.push("quoting enclave did not vouch for the attestation key");
    }

    if (u16(auth, at) !== 5) throw new Error("no certificate chain");
    const pem = new TextDecoder().decode(auth.subarray(at + 6, at + 6 + u32(auth, at + 2)));
    const chain = (pem.match(/-----BEGIN CERTIFICATE-----[^-]+-----END CERTIFICATE-----/g) ?? []).map(certificate);
    const [platform, intermediate, root] = chain;
    if (!platform || !intermediate || !root) throw new Error("certificate chain is incomplete");
    if (!signedRaw(enclaveSignature, enclaveReport, platform.publicKey)) problems.push("quoting enclave report signature does not verify");
    if (!signedBy(platform, intermediate.publicKey)) problems.push("platform certificate is not signed by its issuer");
    if (!signedBy(intermediate, root.publicKey)) problems.push("intermediate certificate is not signed by the root");
    if (!signedBy(root, root.publicKey) || bytesToHex(root.publicKey) !== INTEL_ROOT_KEY) problems.push("root certificate is not the Intel SGX Root CA");

    return { ok: problems.length === 0, problems, quote: parsed };
  } catch (error) {
    return { ok: false, problems: [...problems, error instanceof Error ? error.message : String(error)] };
  }
}
