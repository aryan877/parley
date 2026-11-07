import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** Builds the token first, because the arena embeds the token's wasm to deploy one per coin. */
for (const [crate, file] of [["token", "parley_token"], ["arena", "parley_arena"]] as const) {
  const build = Bun.spawnSync(["cargo", "near", "build", "non-reproducible-wasm", "--manifest-path", join(ROOT, "contracts", crate, "Cargo.toml")], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
  const kept = join(ROOT, "contracts", crate, "res");
  mkdirSync(kept, { recursive: true });
  copyFileSync(join(ROOT, "target/near", file, `${file}.wasm`), join(kept, `${file}.wasm`));
  console.log(`kept contracts/${crate}/res/${file}.wasm`);
}
