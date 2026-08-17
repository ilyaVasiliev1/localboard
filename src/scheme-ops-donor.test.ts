import { describe, expect, it } from "vitest";

import { copy, LOOK, pick, TEXT_LOOK } from "./scheme-ops-donor";

describe("pick", () => {
  it("takes only the requested keys, deep-cloned", () => {
    const donor = {
      strokeColor: "#e03131",
      backgroundColor: "#ffec99",
      fillStyle: "cross-hatch",
      roundness: { type: 3 },
      unrelated: "не вид, а данные",
    };
    const style = pick(donor, LOOK);

    expect(style).toEqual({
      strokeColor: "#e03131",
      backgroundColor: "#ffec99",
      fillStyle: "cross-hatch",
      roundness: { type: 3 },
    });
    expect(style).not.toHaveProperty("unrelated");
    // Клон, а не ссылка: правка одного элемента не протекает в другой.
    expect(style.roundness).not.toBe(donor.roundness);
  });

  it("skips keys the donor never set", () => {
    const donor = { strokeColor: "#1e1e1e" };
    expect(pick(donor, TEXT_LOOK)).toEqual({ strokeColor: "#1e1e1e" });
  });
});

describe("copy", () => {
  const donor = {
    id: "donor-1",
    type: "rectangle",
    strokeColor: "#1e1e1e",
    isDeleted: false,
    seed: 1,
    versionNonce: 1,
    version: 5,
    updated: 1000,
    boundElements: [{ id: "label-1", type: "text" }],
  };

  it("carries the donor's look over facts, not description", () => {
    const clone = copy(donor, { x: 10, y: 20 });

    expect(clone.strokeColor).toBe(donor.strokeColor);
    expect(clone.type).toBe(donor.type);
    expect(clone.x).toBe(10);
    expect(clone.y).toBe(20);
  });

  it("gives the copy its own identity, not the donor's", () => {
    const clone = copy(donor, {});

    expect(clone.id).not.toBe(donor.id);
    expect(clone.seed).not.toBe(donor.seed);
    expect(clone.versionNonce).not.toBe(donor.versionNonce);
    expect(clone.version).toBe(1);
  });

  it("is never deleted, even when the donor was", () => {
    const deletedDonor = { ...donor, isDeleted: true };
    expect(copy(deletedDonor, {}).isDeleted).toBe(false);
  });

  it("does not mutate the donor, and deep-clones its nested fields", () => {
    const clone = copy(donor, {});
    clone.boundElements.push({ id: "extra", type: "text" });
    expect(donor.boundElements).toHaveLength(1);
  });
});
