/**
 * Общие обломки элементов для тестов правки схем. Не код продукта — только
 * то, что нужно нескольким спекам сразу, чтобы не заводить в каждой свою
 * почти одинаковую фабрику.
 */
import { generateNKeysBetween } from "@excalidraw/fractional-indexing";

/**
 * Собранный `@excalidraw/element` читает `window?.DEBUG_FRACTIONAL_INDICES`
 * безусловно — режим сборки в нём уже зашит production, поэтому проверка на
 * тестовое окружение до этого чтения не доходит. Без браузера `window` не
 * объявлен вовсе, и даже опциональная цепочка не спасает от обращения к
 * необъявленному имени. Пустого объекта достаточно: его никто не читает,
 * важно только, что он есть — это не окно, а точка, чтобы обращение к нему
 * не падало.
 */
if (typeof (globalThis as any).window === "undefined") {
  (globalThis as any).window = {};
}

/**
 * Валидные дробные индексы нужны только на самой первой сборке `Scene` в
 * файле — дальше эта проверка троттлится на минуту и реальных копий с
 * дублирующимся индексом уже не видит. Но самый первый вызов обязан пройти
 * по-настоящему, поэтому индекс проставляется всегда.
 */
export const withIndices = (elements: any[]) => {
  const indices = generateNKeysBetween(null, null, elements.length);
  return elements.map((element, i) => ({ ...element, index: indices[i] }));
};

export const rect = (
  id: string,
  x: number,
  y: number,
  overrides: Record<string, any> = {}
) => ({
  id,
  type: "rectangle",
  x,
  y,
  width: 100,
  height: 60,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  roundness: null,
  opacity: 100,
  groupIds: [],
  frameId: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
  ...overrides,
});

type Geometry = { x: number; y: number; points: [number, number][] };

export const arrowBox = (
  id: string,
  geometry: Geometry,
  startId: string | null,
  endId: string | null,
  overrides: Record<string, any> = {}
) => {
  const last = geometry.points[geometry.points.length - 1];
  return {
    id,
    type: "arrow",
    x: geometry.x,
    y: geometry.y,
    width: Math.abs(last[0]),
    height: Math.abs(last[1]),
    angle: 0,
    points: geometry.points,
    lastCommittedPoint: null,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    roundness: null,
    opacity: 100,
    groupIds: [],
    frameId: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    startBinding: startId ? { elementId: startId, focus: 0, gap: 4 } : null,
    endBinding: endId ? { elementId: endId, focus: 0, gap: 4 } : null,
    startArrowhead: null,
    endArrowhead: "arrow",
    ...overrides,
  };
};
