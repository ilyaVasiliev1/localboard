import { Scene } from "@excalidraw/element";
import { describe, expect, it } from "vitest";

import { between } from "./scheme-ops-geometry";
import {
  arrowBetween,
  boundsOf,
  clusterOf,
  connect,
  find,
  translate,
} from "./scheme-ops-scene";
import { arrowBox, rect, withIndices } from "./scheme-test-kit";

describe("find", () => {
  it("returns the element by id", () => {
    const scene = new Scene(withIndices([rect("a", 0, 0)]) as any);
    expect(find(scene, "a", "поиск").id).toBe("a");
  });

  it("names what was being looked for when nothing matches", () => {
    const scene = new Scene(withIndices([rect("a", 0, 0)]) as any);
    expect(() => find(scene, "missing", "сдвиг")).toThrow(
      "сдвиг: элемента missing нет на доске"
    );
  });
});

describe("arrowBetween", () => {
  it("finds the arrow bound exactly between the two blocks", () => {
    const a = rect("a", 0, 0);
    const b = rect("b", 0, 300);
    const link = arrowBox("ab", between(a, b) as any, "a", "b");
    const scene = new Scene(withIndices([a, b, link]) as any);
    expect(arrowBetween(scene, "a", "b").id).toBe("ab");
  });

  it("refuses to invent a connection that isn't there", () => {
    const a = rect("a", 0, 0);
    const b = rect("b", 0, 300);
    const scene = new Scene(withIndices([a, b]) as any);
    expect(() => arrowBetween(scene, "a", "b")).toThrow(
      "Между a и b нет связи — вставлять не во что"
    );
  });
});

describe("boundsOf", () => {
  it("covers every item's box", () => {
    expect(boundsOf([rect("a", 0, 0), rect("b", 200, 300)])).toEqual({
      minX: 0,
      minY: 0,
      maxX: 300,
      maxY: 360,
    });
  });
});

describe("clusterOf", () => {
  it("follows containerId and bindings, not proximity on the canvas", () => {
    const a = rect("a", 0, 0, {
      boundElements: [{ id: "ab", type: "arrow" }],
    });
    const b = rect("b", 0, 300, {
      boundElements: [{ id: "ab", type: "arrow" }],
    });
    const link = arrowBox("ab", between(a, b) as any, "a", "b");
    // Стоит рядом на холсте, но ничем не связан — в кластер попасть не должен.
    const stranger = rect("far", 20, 20);
    const scene = new Scene(withIndices([a, b, link, stranger]) as any);

    const cluster = clusterOf(scene, find(scene, "a", "x"));
    expect(cluster.map((element: any) => element.id).sort()).toEqual([
      "a",
      "ab",
      "b",
    ]);
  });
});

describe("translate", () => {
  it("moves the element and its bound label together", () => {
    const a = rect("a", 0, 0, {
      boundElements: [{ id: "label", type: "text" }],
    });
    const label = {
      id: "label",
      type: "text",
      containerId: "a",
      x: 5,
      y: 5,
      width: 10,
      height: 10,
      text: "x",
      isDeleted: false,
      boundElements: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      updated: 1,
      link: null,
      locked: false,
      groupIds: [],
      frameId: null,
      angle: 0,
    };
    const scene = new Scene(withIndices([a, label]) as any);

    translate(scene, find(scene, "a", "сдвиг"), 40, -10);

    expect(find(scene, "a", "x")).toMatchObject({ x: 40, y: -10 });
    expect(find(scene, "label", "x")).toMatchObject({ x: 45, y: -5 });
  });
});

describe("connect", () => {
  it("gives the new link the donor's actual look, not a fresh one", () => {
    const a = rect("a", 0, 0);
    const b = rect("b", 0, 300);
    const c = rect("c", 300, 0);
    const templateGeometry = between(rect("t1", 0, 0), rect("t2", 0, 300));
    const template = arrowBox("template", templateGeometry as any, null, null, {
      strokeColor: "#e03131",
      strokeWidth: 5,
    });
    const scene = new Scene(withIndices([a, b, c, template]) as any);

    const created = connect(
      scene,
      find(scene, "b", "x"),
      find(scene, "c", "x"),
      find(scene, "template", "x")
    );

    // Донор надёжнее описания словами: значения сняты с него фактически.
    expect(created.strokeColor).toBe("#e03131");
    expect(created.strokeWidth).toBe(5);
    // Своя личность, а не украденная у образца.
    expect(created.id).not.toBe("template");
    expect(created.startBinding.elementId).toBe("b");
    expect(created.endBinding.elementId).toBe("c");
  });
});
