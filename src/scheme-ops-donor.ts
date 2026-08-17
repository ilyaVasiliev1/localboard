/**
 * Донор вида для правки существующей схемы.
 *
 * Канон здесь намеренно не участвует: вид нового или изменённого элемента
 * снимается с соседнего, который человек настроил сам, — донор надёжнее
 * любого описания словами, свойства берутся фактические и их нельзя
 * переврать. Новые элементы делаются копией донора целиком, а не сборкой с
 * нуля: копия наследует и вид, и все служебные поля разом, и гарантированно
 * валидна.
 */
import { randomId, randomInteger } from "@excalidraw/common";

/** Свойства, которые и составляют «вид»: их снимают с донора. */
export const LOOK = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "roundness",
  "opacity",
] as const;

export const TEXT_LOOK = [
  "strokeColor",
  "fontFamily",
  "fontSize",
  "textAlign",
] as const;

export const pick = (element: any, keys: readonly string[]) => {
  const result: Record<string, any> = {};
  for (const key of keys) {
    if (element[key] !== undefined) {
      result[key] = structuredClone(element[key]);
    }
  }
  return result;
};

/**
 * Копия элемента: свой идентификатор и своя история версий.
 *
 * Признак удаления не наследуется намеренно. Образцом может оказаться то, что
 * удалили в этом же запросе, — связь, которая вела к снесённому блоку, вполне
 * годится как образец вида. Унаследованное `isDeleted` дало бы новый элемент,
 * которого на доске нет.
 */
export const copy = <T extends Record<string, any>>(
  element: T,
  changes: Partial<T>
): T => ({
  ...structuredClone(element),
  isDeleted: false,
  id: randomId(),
  seed: randomInteger(),
  versionNonce: randomInteger(),
  version: 1,
  updated: 1,
  ...changes,
});
