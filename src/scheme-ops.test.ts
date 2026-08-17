import { CaptureUpdateAction } from "@excalidraw/element";
import { describe, expect, it, vi } from "vitest";

import { applySchemeOps } from "./scheme-ops";
import { rect, withIndices } from "./scheme-test-kit";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/**
 * Минимальный мок редактора: applySchemeOps трогает только эти два метода,
 * остальные ей не нужны и здесь не изображаются. `updateScene` возвращается
 * отдельно, уже как мок vitest, — так на него не нужно смотреть через
 * `ExcalidrawImperativeAPI`, где у метода нет `.mock`.
 */
const fakeApi = (elements: any[]) => {
  const updateScene = vi.fn();
  const api = {
    getSceneElements: () => elements,
    updateScene,
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updateScene };
};

describe("applySchemeOps — донор вида", () => {
  it("takes the look from the named neighbour, not from a canon", () => {
    const donor = rect("donor", 200, 0, {
      strokeColor: "#e03131",
      backgroundColor: "#ffc9c9",
      fillStyle: "cross-hatch",
      strokeWidth: 4,
    });
    const target = rect("target", 0, 0);
    const scene = withIndices([target, donor]);
    const { api, updateScene } = fakeApi(scene);

    applySchemeOps(api, [{ op: "style", id: "target", from: "donor" }]);

    const [{ elements }] = updateScene.mock.calls[0];
    const styled = elements.find((e: any) => e.id === "target");
    expect(styled.strokeColor).toBe("#e03131");
    expect(styled.backgroundColor).toBe("#ffc9c9");
    expect(styled.fillStyle).toBe("cross-hatch");
    expect(styled.strokeWidth).toBe(4);
    // Донор остаётся собой — правка не потекла назад.
    const untouchedDonor = elements.find((e: any) => e.id === "donor");
    expect(untouchedDonor.strokeColor).toBe("#e03131");
  });
});

describe("applySchemeOps — история правок", () => {
  it("lands as one immediate scene update, so undo takes it whole", () => {
    const a = rect("a", 0, 0);
    const scene = withIndices([a]);
    const { api, updateScene } = fakeApi(scene);

    applySchemeOps(api, [{ op: "move", id: "a", dx: 30, dy: -15 }]);

    // Одна правка — один вызов, и захват немедленный: это и есть точка,
    // которую снимает undo редактора.
    expect(updateScene).toHaveBeenCalledTimes(1);
    const [{ captureUpdate, elements }] = updateScene.mock.calls[0];
    expect(captureUpdate).toBe(CaptureUpdateAction.IMMEDIATELY);

    // Сцена, которую отдал getSceneElements до правки, не тронута: снимок
    // «до» цел, и отмена возвращает доску ровно к нему.
    expect(scene[0]).toMatchObject({ x: 0, y: 0 });

    // А то, что уходит в updateScene, — уже применённая правка.
    const moved = elements.find((e: any) => e.id === "a");
    expect(moved).toMatchObject({ x: 30, y: -15 });
  });
});

describe("applySchemeOps — краевые случаи", () => {
  it("refuses an empty list of edits", () => {
    const { api, updateScene } = fakeApi(withIndices([rect("a", 0, 0)]));
    expect(() => applySchemeOps(api, [])).toThrow(
      "В запросе нет ни одной операции"
    );
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("names the missing element instead of failing silently", () => {
    const { api, updateScene } = fakeApi(withIndices([rect("a", 0, 0)]));
    expect(() =>
      applySchemeOps(api, [{ op: "move", id: "ghost", dx: 1, dy: 1 }])
    ).toThrow("сдвиг: элемента ghost нет на доске");
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("rejects a connect with no arrow anywhere to copy the look from", () => {
    const a = rect("a", 0, 0);
    const b = rect("b", 300, 0);
    const { api } = fakeApi(withIndices([a, b]));
    expect(() =>
      applySchemeOps(api, [{ op: "connect", from: "a", to: "b" }])
    ).toThrow("Нет ни одной стрелки, с которой снять вид связи");
  });
});
