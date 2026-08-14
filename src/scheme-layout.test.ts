import { describe, expect, it } from "vitest";

import { directionOf } from "./scheme-layout";

describe("directionOf", () => {
  it.each([
    ["flowchart LR\nA --> B", "RIGHT"],
    ["graph RL\nA --> B", "LEFT"],
    ["flowchart BT\nA --> B", "UP"],
    ["flowchart TB\nA --> B", "DOWN"],
    ["graph TD\nA --> B", "DOWN"],
  ])("maps %s to %s", (source, expected) => {
    expect(directionOf(source)).toBe(expected);
  });

  it("uses top-to-bottom for malformed or missing headers", () => {
    expect(directionOf("A --> B")).toBe("DOWN");
    expect(directionOf("flowchart diagonal\nA --> B")).toBe("DOWN");
  });
});
