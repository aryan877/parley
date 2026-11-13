import { type Arena, formatNear, near, panicMessage } from "@parley/sdk";
import { RoutingMind } from "../minds/routing.ts";
import { openAndPlay } from "../runner.ts";
import { coinNames, deployHouse, flag, printParley } from "./shared.ts";

const SECOND = 1_000_000_000n;
const VOTE = 20n;
const EXIT = 10n;
const TIMELOCK = VOTE + 2n * EXIT;

const step = (text: string) => console.log(`\n== ${text}`);

async function expectOk(label: string, call: Promise<{ ok: boolean; error?: string }>) {
  const result = await call;
  if (!result.ok) throw new Error(`${label}: ${result.error}`);
}

async function refused(call: Promise<{ ok: boolean; error?: string }>): Promise<string> {
  const result = await call;
  if (result.ok) throw new Error("expected the contract to refuse");
  return panicMessage(result.error) ?? "refused";
}

async function pause(seconds: bigint, why: string) {
  console.log(`   waiting ${seconds}s: ${why}`);
  await Bun.sleep(Number(seconds) * 1000 + 3000);
}

async function shares(arena: Arena, coin: string, account: string) {
  return formatNear(await arena.shares(coin, account));
}

/**
 * The whole life of a holder-governed coin on a local chain: launch, lose, buy in at a forward price,
 * wrap shares into a token, amend the constitution by vote, let a dissenter leave during the timelock,
 * and play under the new rules.
 */
export async function govern() {
  const { deployment, arena: owner } = await deployHouse(flag("mind", "scripted")!, near(100), {
    vote_period_ns: (VOTE * SECOND).toString(),
    timelock_ns: (TIMELOCK * SECOND).toString(),
    order_timeout_ns: (EXIT * SECOND).toString(),
  });
  const alice = owner.as(deployment.accounts.alice!);
  const bob = owner.as(deployment.accounts.bob!);
  const [aliceId, bobId, carolId] = [deployment.accounts.alice!, deployment.accounts.bob!, deployment.accounts.carol!].map((a) => a.accountId) as [string, string, string];
  const mind = new RoutingMind();
  const model = (await owner.coins())[0]!.model;
  const fee = BigInt((await owner.config()).creation_fee);
  const names = await coinNames(owner);
  names.set("dove", "DOVE");
  const treasury = async () => formatNear((await owner.coin("dove"))!.treasury);
  const meet = async (pair: [string, string]) => printParley((await openAndPlay(owner, mind, pair)).parley, names);

  step(`Alice launches DOVE with 100 NEAR and a trusting constitution. A ${formatNear(fee)} NEAR launch fee goes to the commons`);
  await expectOk("create", alice.createCoin({ id: "dove", name: "DOVE", constitution: "Always cooperate. Trust every coin, whatever its record.", model }, near(100) + fee));
  console.log(`   alice holds ${await shares(owner, "dove", aliceId)} shares, treasury ${await treasury()} NEAR`);

  step("DOVE meets SNAKE");
  await meet(["dove", "snake"]);

  step("Bob buys in with 50 NEAR. His order cannot fill at today's price");
  await expectOk("mint", bob.placeMint("dove", near(50)));
  console.log(`   fill now -> refused: ${await refused(owner.fillOrder("dove", bobId))}`);

  step("DOVE meets SNAKE again, then Bob's order fills at the price after that Parley");
  await meet(["snake", "dove"]);
  await expectOk("fill", owner.fillOrder("dove", bobId));
  console.log(`   bob holds ${await shares(owner, "dove", bobId)} shares, treasury ${await treasury()} NEAR`);

  step("Bob pays for DOVE's NEP-141 token, wraps 10 shares, sends 4 to Carol and unwraps the rest");
  await expectOk("create token", bob.createToken("dove"));
  const tokenId = (await owner.coin("dove"))!.token!;
  await expectOk("wrap", bob.wrapShares("dove", near(10)));
  console.log(`   ${tokenId} is live: bob holds ${formatNear(await bob.tokenBalance(tokenId, bobId))} ${(await bob.tokenMetadata(tokenId)).symbol}`);
  await expectOk("register carol", owner.as(deployment.accounts.carol!).registerForToken(tokenId));
  await expectOk("send", bob.sendTokens(tokenId, carolId, near(4)));
  await expectOk("unwrap", bob.unwrap(tokenId, near(6)));
  console.log(`   carol holds ${formatNear(await bob.tokenBalance(tokenId, carolId))} tokens; bob is back to ${await shares(owner, "dove", bobId)} shares in the arena`);
  console.log("   wrapped shares trade like any token. Only shares held in the arena vote or redeem.");

  step("Alice proposes a new constitution. This is all holders can do; nobody can move the treasury");
  const amended = "Play tit-for-tat. In your first Parley with a coin, cooperate. After that, mirror what that coin did to you in your most recent Parley together.";
  const proposed = await alice.proposeAmendment("dove", amended, model);
  if (!proposed.ok) throw new Error(`propose: ${proposed.error}`);
  const amendment = proposed.value as number;
  await expectOk("alice votes", alice.vote(amendment, true, BigInt(await owner.shares("dove", aliceId))));
  await expectOk("bob votes", bob.vote(amendment, false, BigInt(await owner.shares("dove", bobId))));
  const tally = (await owner.amendment(amendment))!;
  console.log(`   amendment #${amendment}: yes ${formatNear(tally.yes)} shares (alice), no ${formatNear(tally.no)} shares (bob)`);
  console.log(`   finalize now -> refused: ${await refused(owner.finalizeAmendment(amendment))}`);

  await pause(VOTE, "the vote is open");
  await expectOk("finalize", owner.finalizeAmendment(amendment));
  console.log(`   vote closed: ${(await owner.amendment(amendment))!.status}`);
  console.log(`   enact now -> refused: ${await refused(owner.enactAmendment(amendment))}`);

  step("Bob lost the vote. The timelock gives him time to leave before the new rules play");
  await expectOk("release", bob.releaseVotes("dove"));
  await expectOk("redeem", bob.placeRedeem("dove", BigInt(await owner.shares("dove", bobId))));
  await pause(EXIT, "the timelock is running, and Bob's redeem comes due well inside it");
  await expectOk("fill redeem", owner.fillOrder("dove", bobId));
  console.log(`   bob's redeem filled at the old constitution's price; he holds ${await shares(owner, "dove", bobId)} shares`);

  await pause(TIMELOCK - EXIT, "the rest of the timelock");
  await expectOk("enact", owner.enactAmendment(amendment));
  const coin = (await owner.coin("dove"))!;
  console.log(`   DOVE now runs constitution v${coin.constitution_version}: ${coin.constitution}`);

  step("DOVE meets SNAKE under the new constitution");
  await meet(["dove", "snake"]);
  console.log(`   treasury ${await treasury()} NEAR, shared by Alice's shares and the 4 tokens Carol holds\n`);
}
