/**
 * Правка схем, которые уже лежат на доске.
 *
 * Отличие от `scheme-inbox` принципиальное. Там схема рождается: mermaid
 * считает раскладку, канон из `scheme-style` задаёт вид, результат кладётся
 * рядом с тем, что уже нарисовано. Здесь схема уже существует — её развели
 * руками, раскрасили, растащили блоки, — и любая правка обязана вписаться в
 * это, а не принести свой вкус. Геометрия правок живёт в `scheme-ops-geometry`,
 * донор вида — в `scheme-ops-donor`, чтение и точечная мутация сцены — в
 * `scheme-ops-scene`, вставка и удаление — в `scheme-ops-insert`; здесь
 * остаётся только диспетчер, который читает список операций и применяет их.
 *
 * Вся правка уходит одним `updateScene` с `captureUpdate: IMMEDIATELY`,
 * поэтому попадает в историю редактора как обычная правка сцены и Cmd+Z
 * отменяет её целиком.
 */
import {
  CaptureUpdateAction,
  Scene,
  redrawTextBoundingBox,
  updateBoundElements,
} from "@excalidraw/element";

import { LOOK, TEXT_LOOK, pick } from "./scheme-ops-donor";
import { insert, remove } from "./scheme-ops-insert";
import {
  boundTextOf,
  connect,
  find,
  setLabel,
  translate,
} from "./scheme-ops-scene";
import type { SchemeOp } from "./scheme-ops-types";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const applyOp = (scene: Scene, operation: SchemeOp): string => {
  switch (operation.op) {
    case "label": {
      const element = find(scene, operation.id, "подпись");
      setLabel(scene, element, operation.text);
      return `подпись ${operation.id} → «${operation.text}»`;
    }
    case "style": {
      const element = find(scene, operation.id, "оформление");
      const donor = find(scene, operation.from, "образец");
      scene.mutateElement(element, pick(donor, LOOK));
      const text = boundTextOf(element, scene);
      const donorText = boundTextOf(donor, scene);
      if (text && donorText) {
        scene.mutateElement(text, pick(donorText, TEXT_LOOK));
        redrawTextBoundingBox(text, element, scene);
      }
      return `оформление ${operation.id} с ${operation.from}`;
    }
    case "move": {
      const element = find(scene, operation.id, "сдвиг");
      translate(scene, element, operation.dx ?? 0, operation.dy ?? 0);
      updateBoundElements(element, scene);
      return `сдвиг ${operation.id} на ${operation.dx ?? 0}, ${
        operation.dy ?? 0
      }`;
    }
    case "delete": {
      const element = find(scene, operation.id, "удаление");
      remove(scene, element);
      return `удалён ${operation.id}`;
    }
    case "connect": {
      const from = find(scene, operation.from, "связь");
      const to = find(scene, operation.to, "связь");
      const template = operation.like
        ? (scene.getElementsIncludingDeleted() as any[]).find(
            (element) => element.id === operation.like
          )
        : (scene.getNonDeletedElements() as any[]).find(
            (element) => element.type === "arrow"
          );
      if (!template) {
        throw new Error("Нет ни одной стрелки, с которой снять вид связи");
      }
      connect(scene, from, to, template);
      return `связь ${operation.from} → ${operation.to}`;
    }
    case "insert": {
      insert(scene, operation.between, operation.text, operation.like);
      return `вставлен «${operation.text}» между ${operation.between[0]} и ${operation.between[1]}`;
    }
    default: {
      throw new Error(`Неизвестная операция: ${JSON.stringify(operation)}`);
    }
  }
};

/**
 * Применяет правки к открытой доске. Либо все, либо ни одной: сцена собирается
 * на копии, и наполовину применённая правка не доезжает до холста — иначе
 * схема осталась бы в состоянии, которого никто не просил.
 */
export const applySchemeOps = (
  api: ExcalidrawImperativeAPI,
  ops: readonly SchemeOp[]
): string[] => {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new Error("В запросе нет ни одной операции");
  }
  const scene = new Scene(
    structuredClone(api.getSceneElements() as any[]) as any
  );

  const done = ops.map((operation) => applyOp(scene, operation));

  api.updateScene({
    elements: scene.getElementsIncludingDeleted() as any,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return done;
};
