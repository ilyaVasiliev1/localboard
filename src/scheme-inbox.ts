/**
 * Ящик схем: внешний инструмент кладёт запрос в `<папка досок>/_inbox`,
 * приложение забирает его и кладёт схему на открытую доску.
 *
 * Почему именно так, а не «сгенерировать файл доски снаружи»: раскладку узлов
 * считает mermaid, а валидные элементы Excalidraw собирает сам редактор — обе
 * эти вещи живут только внутри приложения. Снаружи пришлось бы повторять их
 * вручную, и стрелки получились бы не привязанными: такую схему нельзя двигать,
 * она разваливается от первого же перетаскивания блока.
 *
 * Вставка идёт через обычный `updateScene`, поэтому она попадает в историю
 * правок (Cmd+Z отменяет её целиком) и уезжает в файл штатным автосохранением.
 */
import { CaptureUpdateAction, convertToExcalidrawElements } from "@excalidraw/excalidraw";

import {
  DEFAULT_SCHEME_STYLE,
  roleForShape,
  type SchemeRole,
  type SchemeStyle,
} from "./scheme-style";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

type Placement = "right" | "below" | { x: number; y: number };

export type SchemeRequest = {
  /** Заголовок над схемой. На общей доске без него схемы не различить. */
  title?: string;
  /** Описание на mermaid — основной путь. */
  mermaid?: string;
  /** Готовые скелеты Excalidraw — путь для точного контроля геометрии. */
  elements?: any[];
  /** Куда положить относительно того, что уже на доске. */
  place?: Placement;
  /** Текст узла существующей схемы: «правее вот этой». */
  anchor?: string;
  /** Зазор до соседней схемы, px сцены. */
  gap?: number;
  /** Переназначение роли по тексту узла: точное совпадение или вхождение. */
  roles?: Record<string, SchemeRole>;
  /** Точечные правки визуального канона под конкретный запрос. */
  style?: Partial<SchemeStyle>;
};

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const EMPTY_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const TITLE_GAP = 64;

const isFinitePoint = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Границы набора: у стрелок геометрия лежит в точках, у фигур — в размере. */
const boundsOf = (items: readonly any[]): Bounds | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of items) {
    if (!isFinitePoint(item?.x) || !isFinitePoint(item?.y)) {
      continue;
    }
    const xs: number[] = [];
    const ys: number[] = [];
    if (Array.isArray(item.points) && item.points.length > 0) {
      for (const point of item.points) {
        if (isFinitePoint(point?.[0]) && isFinitePoint(point?.[1])) {
          xs.push(item.x + point[0]);
          ys.push(item.y + point[1]);
        }
      }
    }
    if (xs.length === 0) {
      xs.push(item.x, item.x + (isFinitePoint(item.width) ? item.width : 0));
      ys.push(item.y, item.y + (isFinitePoint(item.height) ? item.height : 0));
    }
    minX = Math.min(minX, ...xs);
    maxX = Math.max(maxX, ...xs);
    minY = Math.min(minY, ...ys);
    maxY = Math.max(maxY, ...ys);
  }

  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
};

/**
 * Связная область вокруг узла с заданным текстом — это и есть «вот та схема».
 * Обход идёт по тем же связям, которыми держится сама схема: подпись знает свой
 * контейнер, стрелка — оба конца, фигура — всё, что к ней привязано. Поэтому
 * соседняя схема, стоящая рядом, но ничем не связанная, в область не попадает.
 */
const anchoredBounds = (
  elements: readonly any[],
  anchor: string,
): Bounds | null => {
  const needle = anchor.trim().toLowerCase();
  if (!needle) {
    return null;
  }
  const byId = new Map<string, any>(elements.map((element) => [element.id, element]));

  const seed = elements.find(
    (element) =>
      typeof element.text === "string" &&
      element.text.toLowerCase().includes(needle),
  );
  if (!seed) {
    return null;
  }

  const visited = new Set<string>();
  const queue = [seed.containerId ? byId.get(seed.containerId) ?? seed : seed];
  const cluster: any[] = [];

  while (queue.length > 0) {
    const element = queue.shift();
    if (!element || visited.has(element.id)) {
      continue;
    }
    visited.add(element.id);
    cluster.push(element);

    const neighbours: (string | undefined)[] = [
      element.containerId,
      element.startBinding?.elementId,
      element.endBinding?.elementId,
      ...(Array.isArray(element.boundElements)
        ? element.boundElements.map((bound: any) => bound?.id)
        : []),
    ];
    for (const id of neighbours) {
      if (id && !visited.has(id)) {
        const neighbour = byId.get(id);
        if (neighbour) {
          queue.push(neighbour);
        }
      }
    }
  }

  return boundsOf(cluster);
};

/** Центр текущего вида — куда класть схему, когда доска ещё пуста. */
const viewportCentre = (api: ExcalidrawImperativeAPI): { x: number; y: number } => {
  const state = api.getAppState();
  const zoom = state.zoom?.value || 1;
  return {
    x: state.width / 2 / zoom - state.scrollX,
    y: state.height / 2 / zoom - state.scrollY,
  };
};

const styleSkeletons = (
  skeletons: readonly any[],
  style: SchemeStyle,
  roles: Record<string, SchemeRole> | undefined,
): any[] => {
  const overrides = Object.entries(roles ?? {}).map(([text, role]) => ({
    needle: text.trim().toLowerCase(),
    role,
  }));

  return skeletons.map((skeleton) => {
    if (skeleton.type === "arrow" || skeleton.type === "line") {
      return {
        ...skeleton,
        strokeColor: style.arrow.strokeColor,
        strokeWidth: style.arrow.strokeWidth,
        roughness: style.roughness,
        ...(style.fontFamily && skeleton.label
          ? { label: { ...skeleton.label, fontFamily: style.fontFamily } }
          : {}),
      };
    }
    if (skeleton.type === "text" || skeleton.type === "image") {
      return skeleton;
    }

    const label: string = skeleton.label?.text ?? "";
    const needle = label.trim().toLowerCase();
    const override = overrides.find(
      (candidate) => needle === candidate.needle || needle.includes(candidate.needle),
    );
    const role = override?.role ?? roleForShape(skeleton.type);
    const shape = style.roles[role];

    return {
      ...skeleton,
      strokeColor: shape.strokeColor,
      backgroundColor: shape.backgroundColor,
      fillStyle: shape.fillStyle,
      strokeWidth: style.strokeWidth,
      roughness: style.roughness,
      // Ромбу скругление не идёт: он теряет узнаваемую форму развилки.
      roundness:
        style.roundness === "round" && skeleton.type === "rectangle"
          ? { type: 3 }
          : null,
      ...(skeleton.label
        ? {
            label: {
              ...skeleton.label,
              strokeColor: shape.strokeColor,
              ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
            },
          }
        : {}),
    };
  });
};

const shift = (skeletons: readonly any[], dx: number, dy: number): any[] =>
  skeletons.map((skeleton) => ({
    ...skeleton,
    x: (skeleton.x ?? 0) + dx,
    y: (skeleton.y ?? 0) + dy,
  }));

const parseRequest = (raw: string): SchemeRequest => {
  let request: SchemeRequest;
  try {
    request = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Запрос не разбирается как JSON: ${error}`);
  }
  if (!request.mermaid && !Array.isArray(request.elements)) {
    throw new Error("В запросе нет ни «mermaid», ни «elements»");
  }
  return request;
};

/**
 * Кладёт схему из запроса на открытую доску. Возвращает, сколько элементов
 * добавлено — этого достаточно и для тоста, и для отчёта наружу.
 */
export const applySchemeRequest = async (
  api: ExcalidrawImperativeAPI,
  raw: string,
): Promise<{ count: number; title?: string }> => {
  const request = parseRequest(raw);
  const style: SchemeStyle = {
    ...DEFAULT_SCHEME_STYLE,
    ...request.style,
    roles: { ...DEFAULT_SCHEME_STYLE.roles, ...request.style?.roles },
    arrow: { ...DEFAULT_SCHEME_STYLE.arrow, ...request.style?.arrow },
    title: { ...DEFAULT_SCHEME_STYLE.title, ...request.style?.title },
  };

  let skeletons: any[];
  let files: Record<string, any> | undefined;
  if (request.mermaid) {
    // Динамический импорт: mermaid со всеми парсерами весит больше мегабайта,
    // и статический импорт утащил бы его в стартовый бандл ради функции,
    // которой за сессию может не быть ни разу.
    const { parseMermaidToExcalidraw } = await import(
      "@excalidraw/mermaid-to-excalidraw"
    );
    const parsed = await parseMermaidToExcalidraw(request.mermaid);
    skeletons = parsed.elements as any[];
    files = parsed.files;
  } else {
    skeletons = request.elements as any[];
  }
  if (skeletons.length === 0) {
    throw new Error("Схема пустая: mermaid не дал ни одного элемента");
  }

  skeletons = styleSkeletons(skeletons, style, request.roles);

  const existing = api.getSceneElements();
  const gap = request.gap ?? 200;
  const place = request.place ?? "right";

  const reference =
    (request.anchor ? anchoredBounds(existing, request.anchor) : null) ??
    boundsOf(existing);

  let target: { x: number; y: number };
  if (typeof place === "object") {
    target = place;
  } else if (!reference) {
    target = viewportCentre(api);
  } else if (place === "below") {
    target = { x: reference.minX, y: reference.maxY + gap };
  } else {
    target = { x: reference.maxX + gap, y: reference.minY };
  }

  const source = boundsOf(skeletons) ?? EMPTY_BOUNDS;
  const titleOffset = request.title ? TITLE_GAP : 0;
  const placed = shift(
    skeletons,
    target.x - source.minX,
    target.y + titleOffset - source.minY,
  );

  if (request.title) {
    placed.unshift({
      type: "text",
      x: target.x,
      y: target.y,
      text: request.title,
      fontSize: style.title.fontSize,
      strokeColor: style.title.strokeColor,
      ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    });
  }

  const converted = convertToExcalidrawElements(placed as any);
  if (files) {
    const list = Object.values(files);
    if (list.length > 0) {
      api.addFiles(list as any);
    }
  }

  api.updateScene({
    elements: [...existing, ...converted],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  // Показать результат: схему кладут не туда, где сейчас смотрит человек,
  // а правее всего нарисованного — без этого вставка выглядит как «ничего
  // не произошло».
  api.setViewport({ target: converted, fit: "scale-down", animation: true });

  return { count: converted.length, title: request.title };
};
