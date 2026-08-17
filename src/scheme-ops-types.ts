/**
 * Словарь правок существующей схемы. Общий тип для диспетчера
 * (`scheme-ops.ts`) и всех модулей, которые его обслуживают.
 */
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
