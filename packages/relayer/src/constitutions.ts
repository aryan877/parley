import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./localnet.ts";

export interface Constitution {
  id: string;
  name: string;
  text: string;
}

export function loadConstitutions(dir = join(ROOT, "constitutions")): Constitution[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => {
      const [title = "", ...body] = readFileSync(join(dir, file), "utf8").trim().split("\n");
      return { id: file.replace(/\.md$/, ""), name: title.replace(/^#\s*/, ""), text: body.join("\n").trim() };
    });
}
