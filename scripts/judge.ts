import { ARCHIVAL_RPC_URLS, type ExecutionStatus, type Model, NearRpc, type Parley, TX_INDEX_URLS, type TxOutcome, base64Text, functionCall, panicMessage, parleyEvents, sha256Hex, verifyReply } from "@parley/sdk";
import { type Attestation, KEPT_WASM, ROOT, committedCodeHash, publicTestnet } from "@parley/relayer";
import { flag } from "@parley/relayer/src/commands/shared.ts";
import { type SignerReport, checkAttestations, describeSigner, readJsonFiles, signerReport } from "@parley/league";
import { recordedLeagues, verifyLeague } from "@parley/league/src/verify.ts";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

interface Result {
  ok: boolean | "skip";
  evidence: string;
  details?: string[];
  rpc?: string;
}

interface Refusal {
  reason: string;
  tx: string;
}

const SITE = flag("site", "https://parley.aryankumar.dev")!.replace(/\/+$/, "");
const TX_INDEX = `${TX_INDEX_URLS.testnet}/v0`;
const SAINT_VS_SNAKE = 12;
const MATCHES = Math.max(1, Math.min(20, Number(flag("matches", "3"))));
const STEPS = [
  ["propose", "propose_amendment"],
  ["vote yes", "vote"],
  ["finalize", "finalize_amendment"],
  ["enact", "enact_amendment"],
] as const;

const deployment = publicTestnet();
const contract = deployment.contractId;
const archival = ARCHIVAL_RPC_URLS.testnet;
const state = new NearRpc([deployment.rpcUrl, ...archival], { timeoutMs: 10_000 });
const history = new NearRpc([...archival, deployment.rpcUrl], { timeoutMs: 10_000 });
const view = <T>(method: string, args: Record<string, unknown> = {}) => state.view<T>(contract, method, args);
const record = <T>(file: string) => JSON.parse(readFileSync(join(ROOT, "deployments", file), "utf8")) as T;

const once = <T>(work: () => Promise<T>) => {
  let started: Promise<T> | undefined;
  return () => (started ??= work());
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const succeeded = (status: ExecutionStatus) => "SuccessValue" in status;
const panicOf = (tx: TxOutcome) => panicMessage(JSON.stringify(tx.status));
const events = (tx: TxOutcome) => parleyEvents(tx.receipts_outcome.flatMap((r) => r.outcome.logs));

async function http<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function each<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  }));
}

const models = once(() => view<Model[]>("get_models"));

const amendment = once(async () => {
  const { coin, constitution, steps } = record<{ coin: string; constitution: string; steps: Record<string, string> }>("testnet-amendment.json");
  const txs = await Promise.all(STEPS.map(([step]) => history.tx(steps[step] ?? "", deployment.owner)));
  const enacted = events(txs[3]!).find((e) => e.event === "amendment_enacted")?.data;
  return { coin, constitution, steps, txs, version: typeof enacted?.constitution_version === "number" ? enacted.constitution_version : null };
});

async function noKeys(): Promise<Result> {
  const { keys, block_height } = await state.accessKeys(contract);
  return {
    ok: keys.length === 0,
    evidence: `${keys.length} keys at block ${block_height}; removed by tx ${deployment.transactions.lock}`,
    rpc: `query view_access_key_list ${contract}`,
  };
}

async function code(): Promise<Result> {
  const local = committedCodeHash();
  const { code_hash } = await state.account(contract);
  const wasm = relative(ROOT, KEPT_WASM);
  return {
    ok: code_hash === local && local === deployment.codeHash,
    evidence: code_hash === local ? `code_hash ${code_hash} = sha256 of ${wasm}` : `code_hash ${code_hash}, but ${wasm} hashes to ${local}`,
    rpc: `query view_account ${contract}`,
  };
}

async function forgeries(): Promise<Result> {
  const f = record<{ parley: number; sender: string; unregisteredKey: Refusal; replayedReply: Refusal }>("testnet-forgeries.json");
  const keys = new Set((await models()).flatMap((m) => m.signers.map((s) => s.public_key)));
  const tries = [
    { label: "a key the arena never registered", refusal: f.unregisteredKey, genuineKey: false },
    { label: "a genuine enclave reply replayed on a new prompt", refusal: f.replayedReply, genuineKey: true },
  ];
  let refused = 0;
  const details: string[] = [];
  for (const { label, refusal, genuineKey } of tries) {
    const tx = await history.tx(refusal.tx, f.sender);
    const call = functionCall(tx);
    const panic = panicOf(tx);
    const ok =
      tx.transaction.receiver_id === contract &&
      call?.method === "submit_turn" &&
      call.args.id === f.parley &&
      panic === refusal.reason &&
      keys.has(String(call.args.public_key).toLowerCase()) === genuineKey;
    if (ok) refused++;
    details.push(`${refusal.tx}  ${label}: ${panic ? `"${panic}"` : "NOT refused"}`);
  }
  return {
    ok: refused === tries.length,
    evidence: `${refused} of ${tries.length} submit_turn calls on Parley ${f.parley} failed with the recorded error`,
    details,
    rpc: `tx <hash> sender ${f.sender}`,
  };
}

async function amended(): Promise<Result> {
  const { coin, constitution, steps, txs, version } = await amendment();
  const proposal = txs[0] && succeeded(txs[0].status) ? Number(base64Text((txs[0].status as { SuccessValue: string }).SuccessValue)) : null;
  const details = STEPS.map(([step, method], i) => {
    const tx = txs[i]!;
    const call = functionCall(tx);
    const target = step === "propose" ? call?.args.coin === coin && call.args.constitution === constitution : call?.args.id === proposal;
    const ok = succeeded(tx.status) && tx.transaction.receiver_id === contract && call?.method === method && target;
    return { ok, line: `${step.padEnd(9)} ${steps[step]}  ${ok ? `${method} succeeded` : `${method} FAILED or does not match the record`}` };
  });
  const now = await view<{ constitution: string; constitution_version: number } | null>("get_coin", { coin });
  const current = !!now && version !== null && (now.constitution_version > version || (now.constitution_version === version && now.constitution === constitution));
  const shows = !now ? "no such coin" : now.constitution === constitution ? `rules v${now.constitution_version}, the voted text` : `rules v${now.constitution_version}`;
  return {
    ok: details.every((d) => d.ok) && current,
    evidence: `${details.filter((d) => d.ok).length} of 4 steps succeeded${version === null ? "" : `, enacted as v${version}`}; get_coin ${coin}: ${shows}`,
    details: details.map((d) => d.line),
    rpc: `tx <hash> sender ${deployment.owner}; query call_function get_coin {"coin":"${coin}"}`,
  };
}

async function saintVsSnake(): Promise<Result> {
  const [p, { version }] = await Promise.all([view<Parley | null>("get_parley", { id: SAINT_VS_SNAKE }), amendment()]);
  if (!p) return { ok: false, evidence: `Parley ${SAINT_VS_SNAKE} does not exist` };
  const saint = p.a === "saint" ? "A" : p.b === "saint" ? "B" : null;
  const [rival, move, rivalMove, rules] = saint === "A" ? [p.b, p.a_move, p.b_move, p.a_constitution_version] : [p.a, p.b_move, p.a_move, p.b_constitution_version];
  const said = p.turns.find((t) => t.side === saint && t.kind === "Talk")?.text ?? "";
  return {
    ok: p.status === "Settled" && saint !== null && rival === "snake" && move === "Defect" && version !== null && rules === version,
    evidence: `SAINT on rules v${rules} chose ${move ?? "nothing"}, ${rival.toUpperCase()} chose ${rivalMove ?? "nothing"}. SAINT said: "${clip(said, 64)}"`,
    rpc: `query call_function get_parley {"id":${SAINT_VS_SNAKE}}`,
  };
}

/** Turn transactions are found through the site, or FastNEAR's public index if the site is down. Neither is trusted: every byte is re-read from RPC. */
async function locate(parleys: Parley[]): Promise<{ source: string; hashes: Map<number, string[]> }> {
  const fromSite = await Promise.all(
    parleys.map((p) =>
      http<{ turns?: { txHash?: string }[] }>(`${SITE}/api/match/${p.id}`)
        .then((e) => (e.turns ?? []).flatMap((t) => (t.txHash ? [t.txHash] : [])))
        .catch(() => []),
    ),
  );
  if (fromSite.every((h, i) => h.length === parleys[i]!.turns.length)) {
    return { source: `${new URL(SITE).host}/api/match/<id>`, hashes: new Map(parleys.map((p, i) => [p.id, fromSite[i]!])) };
  }
  const hashes = new Map(parleys.map((p) => [p.id, [] as string[]]));
  const { account_txs } = await http<{ account_txs: { transaction_hash: string; is_success: boolean }[] }>(`${TX_INDEX}/account`, { account_id: contract });
  const listed = account_txs.filter((t) => t.is_success).map((t) => t.transaction_hash);
  for (let at = 0; at < listed.length && parleys.some((p) => hashes.get(p.id)!.length < p.turns.length); at += 20) {
    const { transactions } = await http<{ transactions: Pick<TxOutcome, "transaction">[] }>(`${TX_INDEX}/transactions`, { tx_hashes: listed.slice(at, at + 20) });
    for (const tx of transactions) {
      const call = functionCall(tx);
      if (call?.method === "submit_turn") hashes.get(Number(call.args.id))?.push(tx.transaction.hash);
    }
  }
  return { source: new URL(TX_INDEX).host, hashes };
}

async function liveSignatures(): Promise<Result> {
  const recent = await view<Parley[]>("get_parleys", { from_index: 0, limit: Math.min(50, MATCHES + 6) });
  const parleys = recent.filter((p) => p.status === "Settled").slice(0, MATCHES);
  if (!parleys.length) return { ok: false, evidence: "no settled Parley on chain" };
  const [registered, { source, hashes }] = await Promise.all([models(), locate(parleys)]);
  const verified = new Map(parleys.map((p) => [p.id, new Set<number>()]));
  const claimed = new Map(parleys.map((p) => [p.id, new Set<number>()]));
  const problems: string[] = [];

  const check = async ({ p, hash }: { p: Parley; hash: string }) => {
    const tx = await history.tx(hash, deployment.owner);
    const call = functionCall(tx);
    const executed = tx.receipts_outcome.find((r) => r.outcome.executor_id === contract);
    if (tx.transaction.receiver_id !== contract || call?.method !== "submit_turn" || call.args.id !== p.id) return `${hash} is not a submit_turn call for Parley ${p.id}`;
    if (!executed || !succeeded(executed.outcome.status)) return `${hash} did not succeed`;
    const reply = { response: String(call.args.response), signature: String(call.args.signature), publicKey: String(call.args.public_key).toLowerCase() };
    const index = p.turns.findIndex((t, i) => !claimed.get(p.id)!.has(i) && t.response_hash === sha256Hex(reply.response));
    if (index < 0) return `${hash} carries a response Parley ${p.id} never recorded`;
    claimed.get(p.id)!.add(index);
    const turn = p.turns[index]!;
    const model = turn.side === "A" ? p.a_model : p.b_model;
    const { header } = await history.block(executed.block_hash);
    const request = await history.view<string | null>(contract, "get_turn_request", { id: p.id }, header.prev_hash);
    if (request === null || sha256Hex(request) !== turn.request_hash) return `Parley ${p.id} turn ${index}: get_turn_request before ${hash} is not the request the chain stored`;
    if (reply.publicKey !== turn.signer || !registered.find((m) => m.id === model)?.signers.some((s) => s.public_key === reply.publicKey)) {
      return `Parley ${p.id} turn ${index}: key ${reply.publicKey.slice(0, 12)}… is not a registered ${model} signer`;
    }
    if (!verifyReply(model, request, reply)) return `Parley ${p.id} turn ${index}: the enclave signature does not verify`;
    verified.get(p.id)!.add(index);
    return null;
  };

  const jobs = parleys.flatMap((p) => (hashes.get(p.id) ?? []).map((hash) => ({ p, hash })));
  await each(jobs, 6, async (job) => {
    const problem = await check(job).catch((error) => `${job.hash}: ${message(error)}`);
    if (problem) problems.push(problem);
  });
  const total = parleys.reduce((n, p) => n + p.turns.length, 0);
  const good = [...verified.values()].reduce((n, s) => n + s.size, 0);
  const sample = parleys.find((p) => hashes.get(p.id)?.length);
  return {
    ok: good === total && !problems.length,
    evidence: `${good} of ${total} replies in Parleys ${parleys.map((p) => p.id).join(", ")} verified`,
    details: [
      ...parleys.map((p) => `Parley ${p.id} ${p.a} vs ${p.b}: ${verified.get(p.id)!.size} of ${p.turns.length}`),
      ...problems.slice(0, 8),
      `tx hashes from ${source}; request = get_turn_request at the block before each reply ran; reply, signature, key = submit_turn arguments`,
    ],
    rpc: sample
      ? `tx ${hashes.get(sample.id)![0]} sender ${deployment.owner}; block <receipt block_hash>; get_turn_request {"id":${sample.id}} at block_id = prev_hash`
      : undefined,
  };
}

async function attestation(): Promise<Result> {
  const onChain = { models: await models() };
  const quotes = readJsonFiles<Attestation>(join(ROOT, "deployments", "testnet-attestation"));
  const keys = signerReport(onChain, [], quotes);
  const intel = keys.filter((k) => k.kind === "intel");
  return {
    ok: keys.length > 0 && intel.length === keys.length,
    evidence: `${intel.length} of ${keys.length} keys in get_models match a recorded quote that names the key and chains to Intel's root key`,
    details: [...keys.map((k) => `${k.model} ${k.publicKey.slice(0, 12)}…  ${describeSigner(k)}`), ...checkAttestations(onChain, quotes).map((f) => f.problem)],
    rpc: "query call_function get_models; quotes in deployments/testnet-attestation",
  };
}

const signedBy = (signers: SignerReport[]) =>
  signers.every((s) => s.kind === "intel") ? " (Intel TDX keys)" : signers.every((s) => s.kind === "stand-in") ? " (public stand-in key, not hardware)" : "";

async function fixtures(): Promise<Result> {
  const verdicts = recordedLeagues().map(verifyLeague);
  const bad = verdicts.filter((v) => v.findings.length);
  return {
    ok: verdicts.length > 0 && !bad.length,
    evidence: verdicts.map((v) => `${v.name}: ${v.parleys} Parleys, ${v.replies} replies${signedBy(v.signers)}${v.findings.length ? `, ${v.findings.length} PROBLEMS` : ""}`).join("; "),
    details: bad.length
      ? bad.flatMap((v) => v.findings.slice(0, 5).map((f) => `${v.name}: ${f.parley === undefined ? "" : `Parley ${f.parley}: `}${f.problem}`))
      : ["signatures, Intel quotes, every request byte, payoffs, treasuries and standings re-derived, no network"],
    rpc: "none, offline: bun run verify",
  };
}

interface Proof {
  file: string;
  label: string;
  hash: string;
  sender: string;
  method?: string;
  refused?: string;
}

function proofList(): Proof[] {
  const list: Proof[] = [];
  const main = record<{ transactions: Record<string, string> }>("testnet.json");
  for (const [label, hash] of Object.entries(main.transactions)) {
    const sender = label.startsWith("fund from ") ? label.slice("fund from ".length) : label === "deploy" || label === "lock" ? contract : deployment.owner;
    const method = label === "init" ? "new" : label.startsWith("create ") ? "create_coin" : undefined;
    list.push({ file: "testnet.json", label, hash, sender, method });
  }
  const f = record<{ sender: string; unregisteredKey: Refusal; replayedReply: Refusal }>("testnet-forgeries.json");
  for (const [label, r] of Object.entries({ "unregistered key": f.unregisteredKey, "replayed reply": f.replayedReply })) {
    list.push({ file: "testnet-forgeries.json", label, hash: r.tx, sender: f.sender, method: "submit_turn", refused: r.reason });
  }
  const { steps } = record<{ steps: Record<string, string> }>("testnet-amendment.json");
  for (const [step, method] of STEPS) list.push({ file: "testnet-amendment.json", label: step, hash: steps[step] ?? "", sender: deployment.owner, method });
  const attacks = record<{ account: string; attacks: Record<string, { method: string; reason: string; tx: string }> }>("testnet-attacks.json");
  for (const [label, a] of Object.entries(attacks.attacks)) list.push({ file: "testnet-attacks.json", label, hash: a.tx, sender: attacks.account, method: a.method, refused: a.reason });
  const holders = record<{ transactions: Record<string, { hash: string; signer: string; method: string }> }>("testnet-holders.json");
  for (const [label, t] of Object.entries(holders.transactions)) list.push({ file: "testnet-holders.json", label, hash: t.hash, sender: t.signer, method: t.method });
  const tokens = record<{ payer: string; transactions: Record<string, string> }>("testnet-tokens.json");
  for (const [label, hash] of Object.entries(tokens.transactions)) list.push({ file: "testnet-tokens.json", label, hash, sender: tokens.payer });
  return list;
}

async function proofs(): Promise<Result> {
  const list = proofList();
  const problems: string[] = [];
  const good = new Map<string, number>();
  const fetchTx = async (p: Proof) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await history.tx(p.hash, p.sender);
      } catch (error) {
        if (attempt >= 3) throw error;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  };
  await each(list, 3, async (p) => {
    const problem = await fetchTx(p).then((tx) => {
      const call = functionCall(tx);
      if (tx.transaction.signer_id !== p.sender) return `signed by ${tx.transaction.signer_id}, not ${p.sender}`;
      if (p.method && call?.method !== p.method) return `calls ${call?.method ?? "no method"}, not ${p.method}`;
      if (p.refused) return panicOf(tx) === p.refused ? null : `expected the refusal "${p.refused}", got ${panicOf(tx) ? `"${panicOf(tx)}"` : "success"}`;
      return succeeded(tx.status) ? null : `failed: ${panicOf(tx) ?? JSON.stringify(tx.status).slice(0, 80)}`;
    }, (error) => message(error));
    if (problem) problems.push(`${p.file} ${p.label} ${p.hash}: ${problem}`);
    else good.set(p.file, (good.get(p.file) ?? 0) + 1);
  });
  const files = [...new Set(list.map((p) => p.file))];
  return {
    ok: !problems.length,
    evidence: `${list.length - problems.length} of ${list.length} transactions in deployments/*.json found on chain with the recorded signer, method and outcome`,
    details: [...files.map((file) => `${file}: ${good.get(file) ?? 0} of ${list.filter((p) => p.file === file).length}`), ...problems.slice(0, 8)],
    rpc: "tx <hash> <signer> for every hash; refusals must fail with the recorded error, everything else must succeed",
  };
}

async function site(): Promise<Result> {
  const url = `${SITE}/api/arena`;
  const body = await http<{ network?: string; contractId?: string; overview?: { parleys?: number } }>(url).catch((error) => message(error));
  if (typeof body === "string") return { ok: "skip", evidence: `${url} did not answer (${body})` };
  return {
    ok: body.network === "testnet" && body.contractId === contract,
    evidence: `${url} reports ${body.network} ${body.contractId}, ${body.overview?.parleys ?? "?"} Parleys`,
  };
}

const CHECKS: [string, () => Promise<Result>][] = [
  ["contract account has no access keys", noKeys],
  ["code on chain is the committed wasm", code],
  ["forged replies were refused on chain", forgeries],
  ["holders rewrote SAINT's constitution", amended],
  [`Parley ${SAINT_VS_SNAKE}: SAINT refused to trust SNAKE`, saintVsSnake],
  ["live replies carry enclave signatures", liveSignatures],
  ["enclave keys are Intel TDX attested", attestation],
  ["recorded leagues re-check offline", fixtures],
  ["every proof transaction is on chain as recorded", proofs],
  ["live site serves this contract", site],
];

const began = Date.now();
const width = Math.max(...CHECKS.map(([what]) => what.length));
console.log(`PARLEY judge: ${contract} on NEAR testnet, read from ${state.urls[0]} and ${history.urls[0]}\n`);
const tally = { PASS: 0, FAIL: 0, SKIP: 0 };
for (const [i, [what, run]] of CHECKS.entries()) {
  const result = await run().catch((error): Result => ({ ok: false, evidence: message(error) }));
  const status = result.ok === "skip" ? "SKIP" : result.ok ? "PASS" : "FAIL";
  tally[status]++;
  console.log(`${status}  ${i + 1}  ${what.padEnd(width)}  ${result.evidence}`);
  for (const line of [...(result.details ?? []), ...(result.rpc ? [`rpc: ${result.rpc}`] : [])]) console.log(`         ${line}`);
}
const seconds = ((Date.now() - began) / 1000).toFixed(1);
console.log(`\n${tally.PASS} passed, ${tally.FAIL} failed, ${tally.SKIP} skipped in ${seconds}s. Every line can be repeated with plain RPC calls: docs/JUDGE.md`);
process.exit(tally.FAIL ? 1 : 0);
