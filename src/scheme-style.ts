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
  arrow: { strokeColor: string; strokeWidth: number };
  title: { fontSize: number; strokeColor: string };
  /** Необязательно и с оговоркой выше — семейство шрифта подписей. */
  fontFamily?: number;
};

/**
 * Палитра приглушённая: на общей доске рядом окажется десяток схем, и если
 * каждая кричит цветом, вместе они не читаются. Роль отличается заливкой,
 * а не обводкой — обводка у всех одна, поэтому схема выглядит как один объект.
 */
export const DEFAULT_SCHEME_STYLE: SchemeStyle = {
  strokeWidth: 1,
  roughness: 1,
  roundness: "round",
  roles: {
    // Обычный шаг — самый частый блок, поэтому самый тихий.
    step: {
      strokeColor: "#1e1e1e",
      backgroundColor: "#f1f0ff",
      fillStyle: "solid",
    },
    // Развилка: янтарный говорит «здесь ветвление» до чтения подписи.
    decision: {
      strokeColor: "#1e1e1e",
      backgroundColor: "#fff3bf",
      fillStyle: "solid",
    },
    // Начало и конец — зелёный, границы схемы видно с любого зума.
    terminal: {
      strokeColor: "#1e1e1e",
      backgroundColor: "#d3f9d8",
      fillStyle: "solid",
    },
    // Смысловой акцент: то, на что нужно смотреть в первую очередь.
    accent: {
      strokeColor: "#5b4ddd",
      backgroundColor: "#dbd8ff",
      fillStyle: "solid",
    },
    // Отказ, ошибка, тупиковая ветка.
    error: {
      strokeColor: "#1e1e1e",
      backgroundColor: "#ffe3e3",
      fillStyle: "solid",
    },
  },
  arrow: { strokeColor: "#4a4a4a", strokeWidth: 1 },
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
