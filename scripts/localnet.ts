import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const HOME = join(ROOT, ".localnet");
const PID = join(HOME, "pid");
const PORT = Number(process.env.LOCALNET_PORT ?? 3030);
const VERSION = "2.14.0";
const CACHE = join(ROOT, ".cache", "near-sandbox", VERSION);

function platform(): string {
  const key = `${process.platform}-${process.arch}`;
  const known: Record<string, string> = { "darwin-arm64": "Darwin-arm64", "linux-x64": "Linux-x86_64", "linux-arm64": "Linux-aarch64" };
  const found = known[key];
  if (!found) throw new Error(`no sandbox node build for ${key}; set NEAR_SANDBOX_BIN to a near-sandbox binary`);
  return found;
}

/** The sandbox node: NEAR_SANDBOX_BIN, a copy fetched by the Rust tests, or a download of the same official build. */
async function binary(): Promise<string> {
  if (process.env.NEAR_SANDBOX_BIN) return process.env.NEAR_SANDBOX_BIN;
  const local = join(CACHE, "near-sandbox");
  if (existsSync(local)) return local;
  if (existsSync(join(ROOT, "target"))) {
    const built = new Bun.Glob("**/near-sandbox-*/near-sandbox").scanSync({ cwd: join(ROOT, "target"), absolute: true, onlyFiles: true });
    for (const path of built) return path;
  }

  const url = `https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/${platform()}/${VERSION}/near-sandbox.tar.gz`;
  console.log(`fetching the NEAR sandbox node ${VERSION} from ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const unpack = join(CACHE, "unpack");
  mkdirSync(unpack, { recursive: true });
  const archive = join(CACHE, "near-sandbox.tar.gz");
  await Bun.write(archive, await res.arrayBuffer());
  const tar = Bun.spawnSync(["tar", "-xzf", archive, "-C", unpack]);
  if (tar.exitCode !== 0) throw new Error(`could not unpack the sandbox node: ${tar.stderr.toString()}`);
  const inner = readdirSync(unpack, { recursive: true }).find((f) => String(f).endsWith("near-sandbox"));
  if (!inner) throw new Error("the archive holds no near-sandbox binary");
  renameSync(join(unpack, String(inner)), local);
  Bun.spawnSync(["chmod", "+x", local]);
  return local;
}

function pid(): number | null {
  if (!existsSync(PID)) return null;
  const value = Number(readFileSync(PID, "utf8").trim());
  try {
    process.kill(value, 0);
    return value;
  } catch {
    return null;
  }
}

async function up(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/status`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function start() {
  if (pid()) return console.log(`localnet already running on http://127.0.0.1:${PORT}`);
  const bin = await binary();
  mkdirSync(HOME, { recursive: true });
  if (!existsSync(join(HOME, "genesis.json"))) {
    const init = Bun.spawnSync([bin, "--home", HOME, "init", "--chain-id", "localnet", "--account-id", "test.near"]);
    if (init.exitCode !== 0) throw new Error(`could not initialise the chain: ${init.stderr.toString().slice(-400)}`);
  }
  const log = openSync(join(HOME, "node.log"), "a");
  const node = Bun.spawn([bin, "--home", HOME, "run", "--rpc-addr", `127.0.0.1:${PORT}`, "--network-addr", `127.0.0.1:${PORT + 21000}`], {
    stdio: ["ignore", log, log],
  });
  node.unref();
  writeFileSync(PID, String(node.pid));
  for (let i = 0; i < 60; i++) {
    if (await up()) return console.log(`localnet up on http://127.0.0.1:${PORT}`);
    await Bun.sleep(500);
  }
  throw new Error(`localnet did not start; see ${join(HOME, "node.log")}`);
}

function stop() {
  const running = pid();
  if (running) {
    process.kill(running);
    console.log("localnet stopped");
  }
  if (existsSync(PID)) renameSync(PID, `${PID}.old`);
}

const commands: Record<string, () => void | Promise<void>> = {
  start,
  fetch: async () => console.log(await binary()),
  stop,
  status: () => console.log(pid() ? `running on http://127.0.0.1:${PORT} (pid ${pid()})` : "stopped"),
  reset: async () => {
    stop();
    await Bun.sleep(1500);
    if (existsSync(HOME)) renameSync(HOME, join(ROOT, `.localnet-old-${Date.now()}`));
    await start();
  },
};

const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error("usage: bun run localnet start | stop | status | reset | fetch");
  process.exit(1);
}
await command();
