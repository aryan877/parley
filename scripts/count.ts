/**
 * Counts every Parley on the live arena and every AI reply the contract accepted, straight from NEAR RPC.
 * Each accepted turn passed the contract's enclave signature check when it arrived, so the reply count is the
 * number of signed replies the contract checked. `bun scripts/count.ts`
 */
export {};

const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.fastnear.com";
const CONTRACT = process.env.PARLEY_CONTRACT ?? "parley-live.testnet";

type Parley = { status: string; turns: unknown[] };

async function view<T>(method_name: string, args: object): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "query",
        params: { request_type: "call_function", finality: "final", account_id: CONTRACT, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
      }),
    }).catch(() => null);
    const body: any = res?.ok ? await res.json() : null;
    if (body?.result?.result) return JSON.parse(Buffer.from(body.result.result).toString());
    if (attempt === 5) throw new Error(`${method_name} failed: ${JSON.stringify(body?.error ?? res?.status)}`);
    await Bun.sleep(1500 * (attempt + 1));
  }
}

const count = { parleys: 0, settled: 0, open: 0, voided: 0, replies: 0 };
for (let from = 0; ; ) {
  const page = await view<Parley[]>("get_parleys", { from_index: from, limit: 50 });
  for (const p of page) {
    count.parleys++;
    count.replies += p.turns.length;
    if (p.status === "Settled") count.settled++;
    else if (p.status === "Void") count.voided++;
    else count.open++;
  }
  from += page.length;
  if (page.length < 50) break;
}

console.log(`${CONTRACT} at ${new Date().toISOString()} (final block)`);
console.log(`${count.parleys} Parleys: ${count.settled} settled, ${count.open} in play, ${count.voided} timed out`);
console.log(`${count.replies} AI replies accepted, each enclave-signed and checked by the contract when it arrived`);
