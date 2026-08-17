/**
 * Правка схем разнесена по предметам ровно затем, чтобы ни один файл не
 * скрывал за собой сотни строк чужой логики. Это единственный способ
 * зафиксировать факт «файл короткий» так, чтобы регрессия — кто-нибудь снова
 * сваливший всё в один модуль — была замечена проверкой, а не на глаз.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const dir = path.dirname(fileURLToPath(import.meta.url));

const SCHEME_OPS_FILES = [
  "scheme-ops.ts",
  "scheme-ops-types.ts",
  "scheme-ops-geometry.ts",
  "scheme-ops-donor.ts",
  "scheme-ops-scene.ts",
  "scheme-ops-insert.ts",
];

const LIMIT = 400;

const isSchemeOpsSource = (name: string) =>
  /^scheme-ops.*\.ts$/.test(name) && !name.endsWith(".test.ts");

describe("правка схем — размер файлов", () => {
  it.each(SCHEME_OPS_FILES)("%s не длиннее %d строк", (name) => {
    const content = fs.readFileSync(path.join(dir, name), "utf8");
    const lines = content.split("\n").length;
    expect(lines).toBeLessThanOrEqual(LIMIT);
  });

  it("не теряет файлов из списка на проверку", () => {
    const present = fs.readdirSync(dir).filter(isSchemeOpsSource);
    expect(present.sort()).toEqual([...SCHEME_OPS_FILES].sort());
  });
});
