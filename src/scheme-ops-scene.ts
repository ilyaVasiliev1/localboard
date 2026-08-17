/**
 * Чтение и точечная мутация сцены, общие для всех правок существующей схемы.
 *
 * Пересчёт связей отдан редактору (`updateBoundElements`, `bindBindingElement`):
 * стрелки после сдвига блоков ведут себя ровно так же, как если бы блоки
 * растащили мышкой.
 */
import {
  Scene,
  bindBindingElement,
  bindBindingElementToFixedPoint,
  updateElbowArrowPoints,
  redrawTextBoundingBox,
  updateBoundElements,
} from "@excalidraw/element";

import { copy } from "./scheme-ops-donor";
import { between, facingSides } from "./scheme-ops-geometry";

export const boundTextOf = (element: any, scene: Scene): any => {
  const bound = (element.boundElements ?? []).find(
    (item: any) => item?.type === "text"
  );
  return bound ? scene.getNonDeletedElementsMap().get(bound.id) : undefined;
};

export const find = (scene: Scene, id: string, what: string): any => {
  const element = scene.getNonDeletedElementsMap().get(id);
  if (!element) {
    throw new Error(`${what}: элемента ${id} нет на доске`);
  }
  return element;
};

/**
 * Связная область вокруг элемента — та же, которой держится сама схема.
 * Раздвигать нужно только её: соседние схемы на общей доске к этой правке
 * отношения не имеют и стоять должны на месте.
 */
export const clusterOf = (scene: Scene, seed: any): any[] => {
  const byId = scene.getNonDeletedElementsMap();
  const visited = new Set<string>();
  const queue = [seed];
  const cluster: any[] = [];

  while (queue.length > 0) {
    const element = queue.shift();
    if (!element || visited.has(element.id)) {
      continue;
    }
    visited.add(element.id);
    cluster.push(element);
    const links = [
      element.containerId,
      element.startBinding?.elementId,
      element.endBinding?.elementId,
      ...(element.boundElements ?? []).map((bound: any) => bound?.id),
    ];
    for (const id of links) {
      const neighbour = id && byId.get(id);
      if (neighbour && !visited.has(neighbour.id)) {
        queue.push(neighbour);
      }
    }
  }
  return cluster;
};

/** Габариты набора — по ним видно, кому вставка стоит на пути. */
export const boundsOf = (items: readonly any[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + (item.width ?? 0));
    maxY = Math.max(maxY, item.y + (item.height ?? 0));
  }
  return { minX, minY, maxX, maxY };
};

/** Сдвиг элемента вместе с его подписью — подпись живёт своими координатами. */
export const translate = (
  scene: Scene,
  element: any,
  dx: number,
  dy: number
) => {
  scene.mutateElement(element, { x: element.x + dx, y: element.y + dy });
  const text = boundTextOf(element, scene);
  if (text) {
    scene.mutateElement(text, { x: text.x + dx, y: text.y + dy });
  }
};

export const setLabel = (scene: Scene, container: any, value: string) => {
  const text = boundTextOf(container, scene);
  if (!text) {
    throw new Error(`У элемента ${container.id} нет подписи`);
  }
  scene.mutateElement(text, { text: value, originalText: value });
  // Пересчёт блока под новый текст: иначе длинная подпись вылезет за границы,
  // а короткая оставит блок неоправданно широким.
  redrawTextBoundingBox(text, container, scene);
  updateBoundElements(container, scene);
};

/**
 * Привязка связи к паре блоков.
 *
 * Прямая просто проводится от края до края. Прямоугольной мало провести
 * концы: маршрут между ними прокладывает редактор, и точку крепления ему
 * нужно назвать явно — иначе магнит утащит конец на середину ближайшей грани,
 * и связь уйдёт вбок, чтобы вернуться обратно.
 */
export const attach = (scene: Scene, arrow: any, from: any, to: any) => {
  if (!arrow.elbowed) {
    scene.mutateElement(arrow, between(from, to) as any);
    bindBindingElement(arrow, from, "orbit", "start", scene);
    bindBindingElement(arrow, to, "orbit", "end", scene);
    return;
  }
  const [start, end] = facingSides(from, to);
  bindBindingElementToFixedPoint(arrow, from, "start", start, scene);
  bindBindingElementToFixedPoint(arrow, to, "end", end, scene);
  const points = arrow.points;
  scene.mutateElement(
    arrow,
    updateElbowArrowPoints(arrow, scene.getNonDeletedElementsMap(), {
      points: [points[0], points[points.length - 1]],
    }) as any
  );
};

export const connect = (
  scene: Scene,
  from: any,
  to: any,
  template: any
): any => {
  const arrow = copy(template, {
    boundElements: null,
    startBinding: null,
    endBinding: null,
    ...between(from, to),
  });
  scene.replaceAllElements([...scene.getElementsIncludingDeleted(), arrow]);
  const live = find(scene, arrow.id, "новая связь");
  attach(scene, live, from, to);
  updateBoundElements(from, scene);
  updateBoundElements(to, scene);
  return live;
};

/** Стрелка ровно между двумя блоками — она и будет разорвана вставкой. */
export const arrowBetween = (
  scene: Scene,
  fromId: string,
  toId: string
): any => {
  const arrow = scene
    .getNonDeletedElements()
    .find(
      (element: any) =>
        element.type === "arrow" &&
        element.startBinding?.elementId === fromId &&
        element.endBinding?.elementId === toId
    );
  if (!arrow) {
    throw new Error(
      `Между ${fromId} и ${toId} нет связи — вставлять не во что`
    );
  }
  return arrow;
};
