import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const built = join(ROOT, "target/near/parley_arena/parley_arena.wasm");
const kept = join(ROOT, "contracts/arena/res/parley_arena.wasm");

const build = Bun.spawnSync(["cargo", "near", "build", "non-reproducible-wasm", "--manifest-path", join(ROOT, "contracts/arena/Cargo.toml")], {
  stdio: ["ignore", "inherit", "inherit"],
});
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
mkdirSync(join(ROOT, "contracts/arena/res"), { recursive: true });
copyFileSync(built, kept);
console.log(`copied to ${kept}`);
