/**
 * Геометрия связей между блоками существующей схемы.
 *
 * Всё здесь — чистые функции над координатами: ни одна не трогает сцену и не
 * знает про Excalidraw-элементы дальше `{x, y, width, height, type}`. Это
 * ровно то, что позволяет проверять их без сцены, редактора и холста.
 */

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
  axis: "vertical" | "horizontal"
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
 * Стороны габаритов, которыми два блока смотрят друг на друга. Ромб отдаёт
 * ветку боковой вершиной: из нижней обе ветки выходят одной точкой, идут
 * вместе и наезжают друг на друга.
 */
export const facingSides = (
  from: any,
  to: any
): [[number, number], [number, number]] => {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  if (from.type === "diamond" && Math.abs(dx) > 24) {
    return dx > 0
      ? [
          [1, 0.5],
          [0.5, 0],
        ]
      : [
          [0, 0.5],
          [0.5, 0],
        ];
  }
  const overlap =
    Math.min(from.x + from.width, to.x + to.width) - Math.max(from.x, to.x);
  const under = overlap > Math.min(from.width, to.width) * 0.25;
  if (under && to.y >= from.y + from.height) {
    return [
      [0.5, 1],
      [0.5, 0],
    ];
  }
  if (under && to.y + to.height <= from.y) {
    return [
      [0.5, 0],
      [0.5, 1],
    ];
  }
  return dx > 0
    ? [
        [1, 0.5],
        [0, 0.5],
      ]
    : [
        [0, 0.5],
        [1, 0.5],
      ];
};
