import { describe, expect, it } from "vitest";

import { between, facingSides } from "./scheme-ops-geometry";

const box = (
  x: number,
  y: number,
  width = 100,
  height = 60,
  type = "rectangle"
) => ({
  x,
  y,
  width,
  height,
  type,
});

describe("between", () => {
  it("draws a straight vertical drop when blocks line up", () => {
    const from = box(0, 0);
    const to = box(0, 200);
    const result = between(from, to);
    // Прямая: старт у нижнего края первого блока, конец у верхнего края
    // второго, ровно два узла маршрута.
    expect(result.x).toBe(50);
    expect(result.y).toBe(60);
    expect(result.points).toEqual([
      [0, 0],
      [0, 140],
    ]);
  });

  it("jogs through the midpoint when blocks are offset both ways", () => {
    const from = box(0, 0);
    const to = box(300, 400);
    const result = between(from, to);
    // Вертикаль доминирует (400 ⩾ 300), но блоки разъехались и по X —
    // маршрут ломается на полпути ровно один раз (4 точки).
    expect(result.points).toEqual([
      [0, 0],
      [0, 170],
      [300, 170],
      [300, 340],
    ]);
  });

  it("goes sideways when the horizontal offset dominates", () => {
    const from = box(0, 0);
    const to = box(400, 0);
    const result = between(from, to);
    expect(result.x).toBe(100);
    expect(result.y).toBe(30);
    expect(result.points).toEqual([
      [0, 0],
      [300, 0],
    ]);
  });
});

describe("facingSides", () => {
  it("leaves a diamond by its side vertex toward the branch", () => {
    const diamond = box(0, 0, 120, 120, "diamond");
    const right = box(300, 0);
    const left = box(-300, 0);
    expect(facingSides(diamond, right)).toEqual([
      [1, 0.5],
      [0.5, 0],
    ]);
    expect(facingSides(diamond, left)).toEqual([
      [0, 0.5],
      [0.5, 0],
    ]);
  });

  it("connects top-to-bottom for a stacked pair", () => {
    const top = box(0, 0);
    const bottom = box(10, 200);
    expect(facingSides(top, bottom)).toEqual([
      [0.5, 1],
      [0.5, 0],
    ]);
  });

  it("connects side-to-side for a row pair", () => {
    const left = box(0, 0);
    const right = box(400, 0);
    expect(facingSides(left, right)).toEqual([
      [1, 0.5],
      [0, 0.5],
    ]);
  });
});
