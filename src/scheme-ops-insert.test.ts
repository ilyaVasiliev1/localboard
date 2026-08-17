import { Scene } from "@excalidraw/element";
import { describe, expect, it } from "vitest";

import { between } from "./scheme-ops-geometry";
import { insert, remove } from "./scheme-ops-insert";
import { arrowBox, rect, withIndices } from "./scheme-test-kit";

describe("remove", () => {
  it("deletes the element and its bound arrows, leaves the rest", () => {
    const a = rect("a", 0, 0, {
      boundElements: [{ id: "ab", type: "arrow" }],
    });
    const b = rect("b", 0, 300, {
      boundElements: [{ id: "ab", type: "arrow" }],
    });
    const c = rect("c", 300, 300);
    const link = arrowBox("ab", between(a, b) as any, "a", "b");
    const d = rect("d", 300, 360);
    const unrelated = arrowBox("other", between(c, d) as any, "c", null);
    const scene = new Scene(withIndices([a, b, c, link, unrelated]) as any);

    remove(scene, scene.getNonDeletedElementsMap().get("a"));

    const byId = Object.fromEntries(
      (scene.getElementsIncludingDeleted() as any[]).map((e) => [e.id, e])
    );
    expect(byId.a.isDeleted).toBe(true);
    expect(byId.ab.isDeleted).toBe(true);
    expect(byId.b.isDeleted).toBe(false);
    expect(byId.c.isDeleted).toBe(false);
    expect(byId.other.isDeleted).toBe(false);
  });
});

describe("insert", () => {
  it("pushes the block down and gives it the donor's look", () => {
    const a = rect("a", 0, 0, {
      boundElements: [{ id: "ab", type: "arrow" }],
    });
    const b = rect("b", 0, 300, {
      backgroundColor: "#ffec99",
      boundElements: [{ id: "ab", type: "arrow" }],
    });
    const link = arrowBox("ab", between(a, b) as any, "a", "b", {
      strokeColor: "#e03131",
      strokeWidth: 5,
    });
    const scene = new Scene(withIndices([a, b, link]) as any);

    insert(scene, ["a", "b"], "Проверка", undefined);

    const live = (scene.getNonDeletedElements() as any[]).filter(
      (element) => element.type !== "arrow"
    );
    const arrows = (scene.getNonDeletedElements() as any[]).filter(
      (element) => element.type === "arrow"
    );

    // Ничего не потерялось и не осело в пустоте: старый и новый блок, плюс
    // вставленный между ними — итого три, и две связи их держат.
    expect(live).toHaveLength(3);
    expect(live.some((e) => e.id === "a")).toBe(true);
    expect(live.some((e) => e.id === "b")).toBe(true);
    expect(arrows).toHaveLength(2);

    const inserted = live.find((e) => e.id !== "a" && e.id !== "b")!;
    // Донор — «b»: вид взят фактический, а не переизобретён.
    expect(inserted.backgroundColor).toBe("#ffec99");
    expect(inserted.y).toBe(300);

    const shifted = live.find((e) => e.id === "b")!;
    // Раздвижка ровно на высоту вставки плюс тот же зазор, что был у пары.
    expect(shifted.y).toBe(600);

    const first = arrows.find((e) => e.startBinding?.elementId === "a")!;
    const second = arrows.find(
      (e) => e.startBinding?.elementId === inserted.id
    )!;
    expect(first.endBinding.elementId).toBe(inserted.id);
    expect(second.endBinding.elementId).toBe("b");
    // Обе половины разорванной связи несут вид исходной стрелки.
    expect(first.strokeColor).toBe("#e03131");
    expect(second.strokeColor).toBe("#e03131");
  });
});
