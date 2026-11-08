import { type Arena, formatNear, near } from "@parley/sdk";
import { RoutingMind } from "../minds/routing.ts";
import { openAndPlay } from "../runner.ts";
import { deployHouse, flag, printParley } from "./shared.ts";

const SECOND = 1_000_000_000n;
const WAIT = 20n;

const step = (text: string) => console.log(`\n== ${text}`);

async function expectOk(label: string, call: Promise<{ ok: boolean; error?: string }>) {
  const result = await call;
  if (!result.ok) throw new Error(`${label}: ${result.error}`);
}

async function refused(call: Promise<{ ok: boolean; error?: string }>): Promise<string> {
  const result = await call;
  if (result.ok) throw new Error("expected the contract to refuse");
  return result.error?.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? "refused";
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
 * amend the constitution by vote, let a dissenter leave during the timelock, and play under the new rules.
 */
export async function govern() {
  const period = (WAIT * SECOND).toString();
  const { deployment, arena: owner } = await deployHouse(flag("mind", "scripted")!, near(100), {
    vote_period_ns: period,
    timelock_ns: period,
    order_timeout_ns: (600n * SECOND).toString(),
  });
  const alice = owner.as(deployment.accounts.alice!);
  const bob = owner.as(deployment.accounts.bob!);
  const [aliceId, bobId] = [deployment.accounts.alice!.accountId, deployment.accounts.bob!.accountId];
  const mind = new RoutingMind();
  const model = (await owner.coins())[0]!.model;
  const treasury = async () => formatNear((await owner.coin("dove"))!.treasury);

  step("Alice launches DOVE with 100 NEAR and a trusting constitution");
  await expectOk("create", alice.createCoin({ id: "dove", name: "DOVE", constitution: "Always cooperate. Trust every coin, whatever its record.", model }, near(100)));
  console.log(`   alice holds ${await shares(owner, "dove", aliceId)} shares, treasury ${await treasury()} NEAR`);

  step("DOVE meets SNAKE");
  printParley((await openAndPlay(owner, mind, ["dove", "snake"])).parley);

  step("Bob buys in with 50 NEAR. His order cannot fill at today's price");
  await expectOk("mint", bob.placeMint("dove", near(50)));
  console.log(`   fill now -> refused: ${await refused(owner.fillOrder("dove", bobId))}`);

  step("DOVE meets SNAKE again, then Bob's order fills at the price after that Parley");
  printParley((await openAndPlay(owner, mind, ["snake", "dove"])).parley);
  await expectOk("fill", owner.fillOrder("dove", bobId));
  console.log(`   bob holds ${await shares(owner, "dove", bobId)} shares, treasury ${await treasury()} NEAR`);

  step("Bob pays for DOVE's NEP-141 token, wraps 10 shares, sends 4 to Carol and unwraps the rest");
  await expectOk("create token", bob.createToken("dove"));
  const tokenId = (await owner.coin("dove"))!.token!;
  const [bobToken, carolToken] = [bob.token(tokenId), owner.as(deployment.accounts.carol!).token(tokenId)];
  const carolId = deployment.accounts.carol!.accountId;
  await expectOk("wrap", bob.wrapShares("dove", tokenId, near(10)));
  console.log(`   ${tokenId} is live: bob holds ${formatNear(await bobToken.balanceOf(bobId))} ${(await bobToken.metadata()).symbol}`);
  await expectOk("register carol", carolToken.register());
  await expectOk("send", bobToken.transfer(carolId, near(4)));
  await expectOk("unwrap", bobToken.unwrap(near(6)));
  console.log(`   carol holds ${formatNear(await bobToken.balanceOf(carolId))} tokens; bob is back to ${await shares(owner, "dove", bobId)} shares in the arena`);
  console.log("   wrapped shares trade like any token. Only shares held in the arena vote or redeem.");

  step("Alice proposes a new constitution. Holders can only do this; nobody can move the treasury");
  const amended = "Play tit-for-tat. In your first Parley with a coin, cooperate. After that, mirror what that coin did to you in your most recent Parley together.";
  await expectOk("propose", alice.proposeAmendment("dove", amended, model));
  await expectOk("alice votes", alice.vote("dove", true, near(100)));
  await expectOk("bob votes", bob.vote("dove", false, BigInt(await owner.shares("dove", bobId))));
  console.log("   alice votes yes with 100 shares, bob votes no with all of his");
  console.log(`   finalize now -> refused: ${await refused(owner.finalizeAmendment("dove"))}`);

  await pause(WAIT, "the vote is open");
  await expectOk("finalize", owner.finalizeAmendment("dove"));
  console.log(`   vote closed: ${(await owner.amendment("dove"))!.status}`);
  console.log(`   enact now -> refused: ${await refused(owner.enactAmendment("dove"))}`);

  step("Bob lost the vote. The timelock gives him time to leave before the new rules play");
  await expectOk("release", bob.releaseVotes("dove"));
  await expectOk("redeem", bob.placeRedeem("dove", BigInt(await owner.shares("dove", bobId))));
  console.log("   bob placed a redeem for all his shares");

  await pause(WAIT, "the timelock is running");
  await expectOk("enact", owner.enactAmendment("dove"));
  const coin = (await owner.coin("dove"))!;
  console.log(`   DOVE now runs constitution v${coin.constitution_version}: ${coin.constitution}`);

  step("DOVE meets SNAKE under the new constitution");
  printParley((await openAndPlay(owner, mind, ["dove", "snake"])).parley);
  await expectOk("fill redeem", owner.fillOrder("dove", bobId));
  console.log(`   bob's redeem filled after that Parley; he holds ${await shares(owner, "dove", bobId)} shares`);
  console.log(`   treasury ${await treasury()} NEAR, shared by Alice's 100 shares and the 4 tokens Carol holds\n`);
}
