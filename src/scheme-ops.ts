/**
 * Правка схем, которые уже лежат на доске.
 *
 * Отличие от `scheme-inbox` принципиальное. Там схема рождается: mermaid
 * считает раскладку, канон из `scheme-style` задаёт вид, результат кладётся
 * рядом с тем, что уже нарисовано. Здесь схема уже существует — её развели
 * руками, раскрасили, растащили блоки, — и любая правка обязана вписаться в
 * это, а не принести свой вкус. Поэтому канон в этом файле не участвует
 * вообще: вид нового элемента снимается с соседнего, который человек настроил
 * сам. Донор надёжнее любого описания словами — свойства берутся фактические,
 * их нельзя переврать.
 *
 * По той же причине новые элементы делаются копией донора, а не сборкой с
 * нуля: копия наследует и вид, и все служебные поля разом, и гарантированно
 * валидна.
 *
 * Пересчёт связей отдан редактору (`updateBoundElements`, `bindBindingElement`):
 * стрелки после сдвига блоков ведут себя ровно так же, как если бы блоки
 * растащили мышкой. Вся правка уходит одним `updateScene`, поэтому Cmd+Z
 * отменяет её целиком, а удаление — это `isDeleted`, а не потеря данных.
 */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import {
  Scene,
  bindBindingElement,
  bindBindingElementToFixedPoint,
  updateElbowArrowPoints,
  fixBindingsAfterDeletion,
  redrawTextBoundingBox,
  updateBoundElements,
} from "@excalidraw/element";
import { randomId, randomInteger } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export type SchemeOp =
  /** Сменить подпись; блок пересчитывается под новый текст. */
  | { op: "label"; id: string; text: string }
  /** Снять вид с другого элемента: цвет, заливку, толщину, шрифт. */
  | { op: "style"; id: string; from: string }
  /** Сдвинуть элемент; связи пересчитываются. */
  | { op: "move"; id: string; dx?: number; dy?: number }
  /** Удалить элемент вместе с его связями. */
  | { op: "delete"; id: string }
  /** Соединить два блока; вид стрелки — с существующей (`like`). */
  | { op: "connect"; from: string; to: string; like?: string }
  /** Вставить блок в разрыв связи, раздвинув схему ниже места вставки. */
  | {
      op: "insert";
      between: [string, string];
      text: string;
      like?: string;
    };

/**
 * Копия элемента: свой идентификатор и своя история версий.
 *
 * Признак удаления не наследуется намеренно. Образцом может оказаться то, что
 * удалили в этом же запросе, — связь, которая вела к снесённому блоку, вполне
 * годится как образец вида. Унаследованное `isDeleted` дало бы новый элемент,
 * которого на доске нет.
 */
const copy = <T extends Record<string, any>>(element: T, changes: Partial<T>): T => ({
  ...structuredClone(element),
  isDeleted: false,
  id: randomId(),
  seed: randomInteger(),
  versionNonce: randomInteger(),
  version: 1,
  updated: 1,
  ...changes,
});

/** Свойства, которые и составляют «вид»: их снимают с донора. */
const LOOK = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "roundness",
  "opacity",
] as const;

const TEXT_LOOK = ["strokeColor", "fontFamily", "fontSize", "textAlign"] as const;

const pick = (element: any, keys: readonly string[]) => {
  const result: Record<string, any> = {};
  for (const key of keys) {
    if (element[key] !== undefined) {
      result[key] = structuredClone(element[key]);
    }
  }
  return result;
};

const boundTextOf = (element: any, scene: Scene): any => {
  const bound = (element.boundElements ?? []).find(
    (item: any) => item?.type === "text",
  );
  return bound ? scene.getNonDeletedElementsMap().get(bound.id) : undefined;
};

const find = (scene: Scene, id: string, what: string): any => {
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
const clusterOf = (scene: Scene, seed: any): any[] => {
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
const boundsOf = (items: readonly any[]) => {
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
const translate = (scene: Scene, element: any, dx: number, dy: number) => {
  scene.mutateElement(element, { x: element.x + dx, y: element.y + dy });
  const text = boundTextOf(element, scene);
  if (text) {
    scene.mutateElement(text, { x: text.x + dx, y: text.y + dy });
  }
};

const setLabel = (scene: Scene, container: any, value: string) => {
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
 * Отрезок от края одного блока до края другого.
 *
 * Привязка концов сама стрелку не двигает: она запоминает, какой точкой блока
 * конец держится, и считает это от того места, где конец сейчас. У копии
 * образца конец лежит там же, где у образца, — то есть у чужой пары блоков.
 * Поэтому геометрию надо провести до привязки, иначе новая связь останется
 * лежать поверх старой и её попросту не видно.
 */
export const between = (from: any, to: any) => {
  const fromCx = from.x + from.width / 2;
  const fromCy = from.y + from.height / 2;
  const toCx = to.x + to.width / 2;
  const toCy = to.y + to.height / 2;

  // Связь выходит из той стороны, в которую блоки разнесены сильнее: у схемы,
  // выстроенной колонкой, это низ и верх, у разложенной в ряд — бока.
  if (Math.abs(toCy - fromCy) >= Math.abs(toCx - fromCx)) {
    const down = toCy > fromCy;
    const startY = down ? from.y + from.height : from.y;
    const endY = down ? to.y : to.y + to.height;
    return route(fromCx, startY, toCx, endY, "vertical");
  }
  const right = toCx > fromCx;
  const startX = right ? from.x + from.width : from.x;
  const endX = right ? to.x : to.x + to.width;
  return route(startX, fromCy, endX, toCy, "horizontal");
};

/**
 * Ортогональный маршрут от точки до точки: прямая, если концы на одной оси, и
 * «лесенка» с поворотом на полпути, если разъехались.
 *
 * Одним отрезком соединять нельзя: он пойдёт наискось, а косая связь в
 * блок-схеме читается как отношение другого рода, чем ортогональная. Правило
 * то же, по которому маршруты строит раскладка, — правки не должны выбиваться
 * из схемы, в которую вписываются.
 */
const route = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  axis: "vertical" | "horizontal",
) => {
  const points: [number, number][] = [[0, 0]];
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) > 2 && Math.abs(dy) > 2) {
    if (axis === "vertical") {
      points.push([0, dy / 2], [dx, dy / 2]);
    } else {
      points.push([dx / 2, 0], [dx / 2, dy]);
    }
  }
  points.push([dx, dy]);
  return {
    x: x1,
    y: y1,
    points,
    width: Math.abs(dx),
    height: Math.abs(dy),
  };
};

/**
 * Стороны габаритов, которыми два блока смотрят друг на друга. Ромб отдаёт
 * ветку боковой вершиной: из нижней обе ветки выходят одной точкой, идут
 * вместе и наезжают друг на друга.
 */
export const facingSides = (
  from: any,
  to: any,
): [[number, number], [number, number]] => {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  if (from.type === "diamond" && Math.abs(dx) > 24) {
    return dx > 0 ? [[1, 0.5], [0.5, 0]] : [[0, 0.5], [0.5, 0]];
  }
  const overlap =
    Math.min(from.x + from.width, to.x + to.width) - Math.max(from.x, to.x);
  const under = overlap > Math.min(from.width, to.width) * 0.25;
  if (under && to.y >= from.y + from.height) {
    return [[0.5, 1], [0.5, 0]];
  }
  if (under && to.y + to.height <= from.y) {
    return [[0.5, 0], [0.5, 1]];
  }
  return dx > 0 ? [[1, 0.5], [0, 0.5]] : [[0, 0.5], [1, 0.5]];
};

/**
 * Привязка связи к паре блоков.
 *
 * Прямая просто проводится от края до края. Прямоугольной мало провести
 * концы: маршрут между ними прокладывает редактор, и точку крепления ему
 * нужно назвать явно — иначе магнит утащит конец на середину ближайшей грани,
 * и связь уйдёт вбок, чтобы вернуться обратно.
 */
const attach = (scene: Scene, arrow: any, from: any, to: any) => {
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
    }) as any,
  );
};

const connect = (
  scene: Scene,
  from: any,
  to: any,
  template: any,
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
const arrowBetween = (scene: Scene, fromId: string, toId: string): any => {
  const arrow = scene
    .getNonDeletedElements()
    .find(
      (element: any) =>
        element.type === "arrow" &&
        element.startBinding?.elementId === fromId &&
        element.endBinding?.elementId === toId,
    );
  if (!arrow) {
    throw new Error(`Между ${fromId} и ${toId} нет связи — вставлять не во что`);
  }
  return arrow;
};

/**
 * Свободная точка на маршруте связи.
 *
 * Середина пути кажется очевидным местом, но коридор возврата проходит мимо
 * чужих блоков, и ровно в середине может оказаться один из них. Поэтому путь
 * перебирается точка за точкой, и берётся первая, где новый блок ни на кого не
 * налезает; если свободной нет — всё-таки середина, чтобы правка не сорвалась.
 */
const freeSpotOn = (
  scene: Scene,
  arrow: any,
  donor: any,
): { x: number; y: number } => {
  const points = arrow.points as [number, number][];
  const blocks = (scene.getNonDeletedElements() as any[]).filter((element) =>
    ["rectangle", "diamond", "ellipse"].includes(element.type),
  );

  // Пробуем не только изломы, но и точки между ними: на длинном прямом
  // участке коридора свободного места обычно больше всего.
  const candidates: [number, number][] = [];
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    for (const share of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      candidates.push([ax + (bx - ax) * share, ay + (by - ay) * share]);
    }
  }

  const clear = candidates.find(([dx, dy]) => {
    const x = arrow.x + dx - donor.width / 2;
    const y = arrow.y + dy - donor.height / 2;
    return !blocks.some(
      (block) =>
        x < block.x + block.width + 16 &&
        block.x < x + donor.width + 16 &&
        y < block.y + block.height + 16 &&
        block.y < y + donor.height + 16,
    );
  });

  const [dx, dy] =
    clear ?? points[Math.floor(points.length / 2)] ?? points[0];
  return { x: arrow.x + dx, y: arrow.y + dy };
};

/**
 * Вставка на маршрут связи, без раздвижки схемы.
 *
 * Блок садится на середину уже проложенного пути: там пусто по построению —
 * маршрут вели в обход блоков. Связь разрывается на две половины по той же
 * точке, поэтому поток остаётся непрерывным.
 */
const onRoute = (
  scene: Scene,
  arrow: any,
  from: any,
  to: any,
  donor: any,
  text: string,
) => {
  const donorText = boundTextOf(donor, scene);
  const spot = freeSpotOn(scene, arrow, donor);

  const node = copy(donor, {
    x: spot.x - donor.width / 2,
    y: spot.y - donor.height / 2,
    boundElements: null,
  });
  const label = donorText
    ? copy(donorText, { text, originalText: text, containerId: node.id })
    : null;
  if (label) {
    node.boundElements = [{ id: label.id, type: "text" }];
  }

  scene.replaceAllElements([
    ...scene.getElementsIncludingDeleted(),
    node,
    ...(label ? [label] : []),
  ]);
  const live = find(scene, node.id, "вставка");
  if (label) {
    redrawTextBoundingBox(find(scene, label.id, "вставка"), live, scene);
  }

  attach(scene, arrow, from, live);
  connect(scene, live, to, arrow);
  updateBoundElements(from, scene);
  updateBoundElements(live, scene);
  updateBoundElements(to, scene);
};

const insert = (
  scene: Scene,
  [fromId, toId]: [string, string],
  text: string,
  likeId: string | undefined,
) => {
  const from = find(scene, fromId, "вставка");
  const to = find(scene, toId, "вставка");
  const donor = likeId ? find(scene, likeId, "образец") : to;
  const arrow = arrowBetween(scene, fromId, toId);

  // Обратное ребро цикла — отдельный случай. Оно идёт против потока, снизу
  // вверх, и «раздвинуть схему ниже места вставки» для него бессмысленно:
  // ниже находится сам источник. Зато у такой связи есть свой коридор,
  // проложенный в стороне от блоков, и место в нём уже есть — новый блок
  // встаёт прямо на маршрут, никого не двигая.
  if (to.y + to.height <= from.y) {
    onRoute(scene, arrow, from, to, donor, text);
    return;
  }

  // Схему растят в ту сторону, в которую она и растёт: колонку — вниз, ряд —
  // вправо. Раздвинуть ряд по вертикали значит развалить его раскладку.
  const down =
    Math.abs(to.y - from.y) >= Math.abs(to.x - from.x);

  // Зазор берётся фактический — тот, который человек оставил между этими же
  // двумя блоками. Схема после вставки сохраняет свой ритм, а не приходит к
  // некоторому «правильному» шагу, придуманному здесь.
  const gap = Math.max(
    down ? to.y - (from.y + from.height) : to.x - (from.x + from.width),
    40,
  );
  const donorText = boundTextOf(donor, scene);

  // Вставка встаёт в колонку ВЕРХНЕГО блока, а не нижнего. Нижний может быть
  // точкой слияния нескольких веток, и колонка под ним — общий ствол: блок,
  // поставленный туда, оказывается на пути у чужих связей, и они идут прямо
  // сквозь него. Верхний блок — это та самая ветка, которой вставка и
  // принадлежит.
  const node = copy(donor, {
    x: down
      ? from.x + from.width / 2 - donor.width / 2
      : from.x + from.width + gap,
    y: down
      ? from.y + from.height + gap
      : from.y + from.height / 2 - donor.height / 2,
    boundElements: null,
    // Стрелки донора новому блоку не принадлежат.
  });
  const label = donorText
    ? copy(donorText, {
        text,
        originalText: text,
        containerId: node.id,
      })
    : null;
  if (label) {
    node.boundElements = [{ id: label.id, type: "text" }];
  }

  // Раздвижка: всё, что в этой же схеме лежит не выше нижнего блока, уезжает
  // вниз ровно на высоту вставки. Взаимное расположение сохраняется целиком —
  // это и есть «доработать», а не «перерисовать».
  const shift = (down ? node.height : node.width) + gap;
  const edge = down ? to.y : to.x;
  const cluster = clusterOf(scene, to);
  const family = new Set(cluster.map((element: any) => element.id));

  for (const element of cluster) {
    const own = down ? element.y : element.x;
    if (own >= edge && element.id !== arrow.id && !element.containerId) {
      translate(scene, element, down ? 0 : shift, down ? shift : 0);
    }
  }

  // Соседние схемы тоже отодвигаются. Доска — это колонка схем, идущих одна
  // за другой; выросшая схема иначе просто въезжает в следующую, и на месте
  // аккуратной вставки получается каша из наехавших друг на друга блоков.
  // Двигаются только те, кто стоит на пути: схема сбоку остаётся на месте.
  const span = boundsOf(cluster);
  for (const element of scene.getNonDeletedElements() as any[]) {
    if (family.has(element.id) || element.containerId) {
      continue;
    }
    const own = down ? element.y : element.x;
    const across = down
      ? element.x < span.maxX && element.x + (element.width ?? 0) > span.minX
      : element.y < span.maxY && element.y + (element.height ?? 0) > span.minY;
    if (own >= edge && across) {
      translate(scene, element, down ? 0 : shift, down ? shift : 0);
    }
  }

  scene.replaceAllElements([
    ...scene.getElementsIncludingDeleted(),
    node,
    ...(label ? [label] : []),
  ]);
  const live = find(scene, node.id, "вставка");
  if (label) {
    const text = find(scene, label.id, "вставка");
    redrawTextBoundingBox(text, live, scene);
    // Ширину блок унаследовал от донора, а текст у вставки свой и может быть
    // длиннее — тогда слово рвётся посередине и читается как опечатка. Блок
    // расширяется, пока каждое слово не встанет целиком; растёт он в обе
    // стороны, чтобы остаться в своей колонке.
    const words = text.originalText.split(/\s+/).filter(Boolean);
    const broken = () =>
      words.some(
        (word: string) =>
          !text.text.split("\n").some((line: string) => line.includes(word)),
      );
    const limit = live.width * 2;
    while (broken() && live.width < limit) {
      scene.mutateElement(live, {
        x: live.x - live.width * 0.075,
        width: live.width * 1.15,
      });
      redrawTextBoundingBox(text, live, scene);
    }
  }

  // Старая связь не удаляется, а переставляется концом на новый блок: так
  // сохраняются её вид и подпись, которые человек мог менять руками.
  attach(scene, arrow, from, live);
  connect(scene, live, to, arrow);
  updateBoundElements(from, scene);
  updateBoundElements(live, scene);
  updateBoundElements(to, scene);
};

const remove = (scene: Scene, element: any) => {
  const doomed = [element];
  const text = boundTextOf(element, scene);
  if (text) {
    doomed.push(text);
  }
  for (const candidate of scene.getNonDeletedElements() as any[]) {
    if (
      candidate.type === "arrow" &&
      (candidate.startBinding?.elementId === element.id ||
        candidate.endBinding?.elementId === element.id)
    ) {
      doomed.push(candidate);
      const arrowText = boundTextOf(candidate, scene);
      if (arrowText) {
        doomed.push(arrowText);
      }
    }
  }
  for (const item of doomed) {
    scene.mutateElement(item, { isDeleted: true });
  }
  // Ссылки на удалённое остаются у соседей и однажды приводят к стрелке,
  // висящей в пустоте, — редактор умеет вычищать их сам.
  fixBindingsAfterDeletion(scene.getElementsIncludingDeleted(), doomed);
};

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
      return `сдвиг ${operation.id} на ${operation.dx ?? 0}, ${operation.dy ?? 0}`;
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
            (element) => element.id === operation.like,
          )
        : (scene.getNonDeletedElements() as any[]).find(
            (element) => element.type === "arrow",
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
  ops: readonly SchemeOp[],
): string[] => {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new Error("В запросе нет ни одной операции");
  }
  const scene = new Scene(
    structuredClone(api.getSceneElements() as any[]) as any,
  );

  const done = ops.map((operation) => applyOp(scene, operation));

  api.updateScene({
    elements: scene.getElementsIncludingDeleted() as any,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return done;
};
