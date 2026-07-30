/**
 * Оформление схем, которые приходят из ящика `_inbox`.
 *
 * Это единственное место, где живёт визуальный канон схем: правишь здесь —
 * меняется всё, что кладётся на доски дальше. Роль узла определяется формой,
 * которую задал mermaid, и может быть переназначена в самом запросе.
 *
 * Чего здесь намеренно НЕТ: размера и семейства шрифта. Ширину и высоту блоков
 * mermaid считает по реально отрисованному тексту, и любая правка метрик после
 * этого расчёта выгоняет подпись за границы блока. Шрифт задаётся в запросе
 * (`style.fontFamily`) только вместе с осознанной готовностью к этому.
 */

export type SchemeRole = "step" | "decision" | "terminal" | "accent" | "error";

type ShapeStyle = {
  strokeColor: string;
  backgroundColor: string;
  fillStyle: "solid" | "hachure" | "cross-hatch";
};

export type SchemeStyle = {
  /** Общее для всех фигур: толщина обводки и степень «нарисованности». */
  strokeWidth: number;
  roughness: number;
  /** Скругление прямоугольников: `round` — мягкие углы, `sharp` — прямые. */
  roundness: "round" | "sharp";
  roles: Record<SchemeRole, ShapeStyle>;
  arrow: {
    strokeColor: string;
    strokeWidth: number;
    /** `sharp` — прямые звенья, `round` — сглаженные кривые. */
    shape: "sharp" | "round";
  };
  title: { fontSize: number; strokeColor: string };
  /** Необязательно и с оговоркой выше — семейство шрифта подписей. */
  fontFamily?: number;
};

/**
 * Схемы приходят чёрно-белыми — сознательно.
 *
 * Цвет на доске означает смысл, и назначает этот смысл человек, который с
 * доской работает: что здесь главное, что под вопросом, что уже сделано.
 * Схема, пришедшая уже раскрашенной, занимает этот канал первой и навязывает
 * чужую расстановку акцентов, которую потом приходится стирать. Пустая заливка
 * оставляет решение за владельцем доски и красится в два клика.
 *
 * Роли при этом остаются: они по-прежнему различают форму и обводку и держат
 * место для цвета. Захочется вернуть палитру — достаточно проставить
 * `backgroundColor` нужным ролям, остальной конвейер уже готов.
 */
const MONOCHROME: ShapeStyle = {
  strokeColor: "#1e1e1e",
  // `transparent`, а не белый: белая заливка перекрывает сетку холста и всё,
  // что человек нарисовал под схемой.
  backgroundColor: "transparent",
  fillStyle: "solid",
};

export const DEFAULT_SCHEME_STYLE: SchemeStyle = {
  strokeWidth: 1,
  roughness: 1,
  roundness: "round",
  roles: {
    step: { ...MONOCHROME },
    decision: { ...MONOCHROME },
    terminal: { ...MONOCHROME },
    accent: { ...MONOCHROME },
    error: { ...MONOCHROME },
  },
  /*
   * Стрелки — прямыми звеньями. Excalidraw по умолчанию сглаживает ломаную в
   * кривую, и на схеме из десятка блоков связи начинают выглядеть петлями:
   * читается «нарисовано от души», а не «отсюда сюда». Прямые звенья к тому же
   * честнее показывают, где именно связь поворачивает.
   */
  arrow: { strokeColor: "#1e1e1e", strokeWidth: 1, shape: "sharp" },
  title: { fontSize: 28, strokeColor: "#1e1e1e" },
};

/** Форма, которую выбрал mermaid, — она же и роль по умолчанию. */
export const roleForShape = (type: string): SchemeRole => {
  switch (type) {
    case "diamond":
      return "decision";
    case "ellipse":
      return "terminal";
    default:
      return "step";
  }
};
