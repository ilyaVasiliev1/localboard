/**
 * Раскладка схемы по правилам построения блок-схем.
 *
 * Разделение работ здесь принципиальное. Mermaid остаётся разборщиком текста:
 * он превращает описание в граф — блоки с их формами и подписями, связи с
 * условиями ветвей. Считать раскладку ему больше не поручается, потому что
 * геометрию он отдаёт вместе с маршрутами, а маршруты у него косые и о чужих
 * блоках не знают. Дальше граф уходит в ELK, а тот делает то, что в
 * литературе описано как конвейер Сугиямы: разрывает циклы, раскладывает по
 * слоям, режет длинные рёбра узлами-пустышками, минимизирует пересечения и
 * только потом прокладывает ортогональные маршруты по коридорам.
 *
 * Ради чего именно ELK, а не свои эвристики: три из четырёх наших бед лечатся
 * не маршрутом, а фазой раскладки.
 *
 * — Линия сквозь блок. Длинное ребро — это не отрезок, а цепочка пустышек по
 *   одной на каждый промежуточный слой. Пустышка занимает место наравне с
 *   блоком, поэтому пройти сквозь блок линия структурно не может.
 * — Подпись поверх карточки. Подпись тоже пустышка, вставленная в ребро ДО
 *   назначения слоёв: место под неё резервируется, а не подбирается потом.
 * — Две связи, слипшиеся в одну линию. Общий коридор дают только рёбрам с
 *   общим источником; чужие разводятся по разным слотам канала.
 *
 * Четвёртая — возврат цикла через полсхемы — лечится тем, что обратные рёбра
 * ELK разворачивает на время раскладки и ведёт снаружи.
 */

/** Разбор mermaid: блоки и связи, как их понял парсер. */
type Skeleton = any;

export type Routed = {
  nodes: Map<string, { x: number; y: number; width: number; height: number }>;
  edges: Map<
    string,
    {
      points: [number, number][];
      label?: { x: number; y: number };
    }
  >;
};

/**
 * Настройки взяты по рекомендациям ELK и стандарта, а не подобраны на глаз.
 *
 * Зазоры «линия к линии» и «линия к блоку» задаются раздельно: это разные
 * пороги различимости, и один общий параметр либо раздувает схему, либо
 * оставляет слипшиеся линии. Межслойный зазор ELK при необходимости расширит
 * сам — ровно настолько, сколько коридоров понадобилось.
 */
const OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.cycleBreaking.strategy": "GREEDY",
  "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  // Тщательность перебора при минимизации пересечений: пересечение читается
  // тяжелее любого лишнего излома, поэтому на нём не экономим.
  "elk.layered.thoroughness": "12",
  "elk.spacing.nodeNode": "56",
  "elk.layered.spacing.nodeNodeBetweenLayers": "72",
  "elk.spacing.edgeEdge": "18",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "18",
  "elk.spacing.edgeNode": "24",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.spacing.edgeLabel": "8",
  "elk.spacing.labelNode": "12",
  // Подпись ветви ставится у своего ромба, а не посреди длинной связи: иначе
  // «да» и «нет» приходится искать по всей схеме.
  "elk.layered.edgeLabels.centerLabelPlacementStrategy": "TAIL_LAYER",
  "elk.edgeLabels.inline": "false",
};

/**
 * Направление берётся из самого описания: `flowchart LR` человек пишет тогда,
 * когда схему нужно читать слева направо, и разворачивать её в колонку —
 * значит не понять просьбу.
 */
export const directionOf = (mermaid: string): string => {
  const match = /(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)/i.exec(mermaid);
  switch (match?.[1]?.toUpperCase()) {
    case "LR":
      return "RIGHT";
    case "RL":
      return "LEFT";
    case "BT":
      return "UP";
    default:
      return "DOWN";
  }
};

const isArrow = (skeleton: Skeleton) =>
  skeleton.type === "arrow" || skeleton.type === "line";

/** Габарит подписи ветви: по нему ELK и резервирует место. */
const labelSize = (text: string) => ({
  width: Math.max(24, text.length * 11),
  height: 24,
});

/**
 * Страховка от косого отрезка.
 *
 * ELK почти всегда отдаёт ортогональный маршрут, но у короткого ребра между
 * невыровненными блоками может вернуть его одним отрезком — и тот пойдёт
 * наискось. Косая связь в блок-схеме читается как другой тип отношения, чем
 * ортогональная, поэтому такой отрезок разбивается на «лесенку» через
 * середину основного направления.
 */
const orthogonal = (points: [number, number][]): [number, number][] => {
  const out: [number, number][] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = out[out.length - 1];
    const [bx, by] = points[i];
    if (Math.abs(bx - ax) > 2 && Math.abs(by - ay) > 2) {
      // Поворот на полпути: связь уходит по главному направлению, доводится
      // поперёк и снова идёт по главному — так же, как её провели бы руками.
      const middle = (ay + by) / 2;
      out.push([ax, middle], [bx, middle]);
    }
    out.push([bx, by]);
  }
  return out;
};

/**
 * Считает раскладку. Возвращает координаты блоков и готовые маршруты связей
 * в тех же координатах — остаётся только перенести схему на нужное место.
 */
export const layoutScheme = async (
  skeletons: readonly Skeleton[],
  direction: string,
): Promise<Routed | null> => {
  const nodes = skeletons.filter(
    (skeleton) => !isArrow(skeleton) && skeleton.id,
  );
  const arrows = skeletons.filter((skeleton) => isArrow(skeleton));
  if (nodes.length === 0) {
    return null;
  }

  // Динамический импорт: движок раскладки весит около мегабайта и нужен
  // только когда схему действительно строят.
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const elk = new ELK();

  const graph = {
    id: "root",
    layoutOptions: { ...OPTIONS, "elk.direction": direction },
    children: nodes.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
    })),
    edges: arrows
      .filter((arrow) => arrow.start?.id && arrow.end?.id)
      .map((arrow, index) => {
        const text: string = arrow.label?.text ?? "";
        return {
          id: `e${index}`,
          sources: [arrow.start.id],
          targets: [arrow.end.id],
          ...(text ? { labels: [{ text, ...labelSize(text) }] } : {}),
        };
      }),
  };

  const result: any = await elk.layout(graph as any);

  const placed = new Map<string, any>();
  for (const child of result.children ?? []) {
    placed.set(child.id, {
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? 0,
      height: child.height ?? 0,
    });
  }

  const routes = new Map<string, any>();
  for (const edge of result.edges ?? []) {
    const section = edge.sections?.[0];
    if (!section) {
      continue;
    }
    const points = orthogonal([
      [section.startPoint.x, section.startPoint.y],
      ...(section.bendPoints ?? []).map(
        (point: any) => [point.x, point.y] as [number, number],
      ),
      [section.endPoint.x, section.endPoint.y],
    ]);
    const label = edge.labels?.[0];
    routes.set(edge.id, {
      points,
      ...(label ? { label: { x: label.x ?? 0, y: label.y ?? 0 } } : {}),
    });
  }

  return { nodes: placed, edges: routes };
};
