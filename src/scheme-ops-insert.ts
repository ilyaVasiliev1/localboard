/**
 * Вставка блока в разрыв связи и удаление элемента — самые тяжёлые правки:
 * обе раздвигают или стягивают то, что вокруг, а не только меняют один
 * элемент.
 */
import {
  Scene,
  fixBindingsAfterDeletion,
  redrawTextBoundingBox,
  updateBoundElements,
} from "@excalidraw/element";

import { copy } from "./scheme-ops-donor";
import {
  arrowBetween,
  attach,
  boundsOf,
  boundTextOf,
  clusterOf,
  connect,
  find,
  translate,
} from "./scheme-ops-scene";

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
  donor: any
): { x: number; y: number } => {
  const points = arrow.points as [number, number][];
  const blocks = (scene.getNonDeletedElements() as any[]).filter((element) =>
    ["rectangle", "diamond", "ellipse"].includes(element.type)
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
        block.y < y + donor.height + 16
    );
  });

  const [dx, dy] = clear ?? points[Math.floor(points.length / 2)] ?? points[0];
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
  text: string
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

export const insert = (
  scene: Scene,
  [fromId, toId]: [string, string],
  text: string,
  likeId: string | undefined
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
  const down = Math.abs(to.y - from.y) >= Math.abs(to.x - from.x);

  // Зазор берётся фактический — тот, который человек оставил между этими же
  // двумя блоками. Схема после вставки сохраняет свой ритм, а не приходит к
  // некоторому «правильному» шагу, придуманному здесь.
  const gap = Math.max(
    down ? to.y - (from.y + from.height) : to.x - (from.x + from.width),
    40
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
          !text.text.split("\n").some((line: string) => line.includes(word))
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

export const remove = (scene: Scene, element: any) => {
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
