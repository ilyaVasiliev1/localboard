#!/usr/bin/env node
/**
 * Работа с досками из терминала — вторая половина связки «ассистент ↔ доска».
 *
 *   node scripts/board.mjs list
 *   node scripts/board.mjs read "Пайплайн VoicePaste"
 *   node scripts/board.mjs send схема.json
 *   node scripts/board.mjs send --mermaid схема.mmd --title "Диктовка" --anchor "Готовность"
 *
 * `read` пересказывает доску словами: сырой JSON на две сотни элементов — это
 * десятки тысяч токенов, из которых девять десятых служебные (seed, version,
 * groupIds), и по нему невозможно увидеть, что схема, собственно, говорит.
 *
 * `send` кладёт запрос в ящик; вставку делает само приложение — только у него
 * есть раскладка mermaid и сборщик валидных элементов.
 */
import { readFile, writeFile, readdir, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const CONFIG = path.join(
  homedir(),
  "Library/Application Support/com.localboard.local/config.json",
);
const FALLBACK_DIR = path.join(homedir(), "Documents/LocalBoard");
const EXT = ".excalidraw";

/** Подключённые папки, в порядке приложения; `boards_dir` — прежняя одиночная. */
const allFolders = async () => {
  try {
    const config = JSON.parse(await readFile(CONFIG, "utf8"));
    const list = [...(config.folders ?? []), config.boards_dir].filter(
      (dir) => dir && existsSync(dir),
    );
    if (list.length > 0) {
      return list;
    }
  } catch {
    // Конфига нет до первого запуска приложения — это норма.
  }
  return existsSync(FALLBACK_DIR) ? [FALLBACK_DIR] : [];
};

/**
 * Папка «своего» проекта — та, внутри которой запущен ассистент.
 *
 * В этом вся суть подключаемых папок: доски лежат рядом с проектом, и агент,
 * открытый в проекте, должен работать с его досками, а не с чужими. Если
 * текущий каталог ни к одной не относится — берём первую подключённую.
 */
const currentFolder = async () => {
  const folders = await allFolders();
  if (folders.length === 0) {
    throw new Error(
      "Нет подключённых папок. Подключите папку в приложении LocalBoard.",
    );
  }
  const cwd = process.cwd();
  return (
    folders.find((dir) => cwd === dir || cwd.startsWith(`${dir}/`)) ??
    folders[0]
  );
};

const listBoards = async (dir) =>
  (await readdir(dir))
    .filter((name) => name.endsWith(EXT))
    .sort((a, b) => a.localeCompare(b, "ru"));

/**
 * Доска ищется во всех подключённых папках, но своя — первой: одинаковые имена
 * («Архитектура») в разных проектах это норма, и брать чужую нельзя.
 */
const resolveBoard = async (query) => {
  const home = await currentFolder();
  const folders = [home, ...(await allFolders()).filter((dir) => dir !== home)];
  const needle = query.toLowerCase().replace(EXT, "");

  const known = [];
  for (const dir of folders) {
    const boards = await listBoards(dir);
    boards.forEach((name) => known.push(path.basename(name, EXT)));
    const match =
      boards.find((name) => name.replace(EXT, "").toLowerCase() === needle) ??
      boards.find((name) => name.toLowerCase().includes(needle));
    if (match) {
      return path.join(dir, match);
    }
  }
  throw new Error(`Доска «${query}» не найдена. Есть: ${known.join(", ")}`);
};

const SHAPES = {
  rectangle: "прямоугольник",
  diamond: "ромб",
  ellipse: "овал",
  arrow: "стрелка",
  line: "линия",
  text: "текст",
  image: "картинка",
  freedraw: "от руки",
};

const bounds = (items) => {
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

/**
 * Разбор доски на связные схемы. Границу проводят те же связи, которыми схема
 * держится: подпись знает контейнер, стрелка — оба конца, фигура — всё
 * привязанное. Две схемы, стоящие рядом, но не соединённые, останутся разными.
 */
const clusterize = (elements) => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const seen = new Set();
  const clusters = [];

  for (const element of elements) {
    if (seen.has(element.id)) {
      continue;
    }
    const queue = [element];
    const cluster = [];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current.id)) {
        continue;
      }
      seen.add(current.id);
      cluster.push(current);
      const links = [
        current.containerId,
        current.startBinding?.elementId,
        current.endBinding?.elementId,
        ...(current.boundElements ?? []).map((bound) => bound?.id),
      ];
      for (const id of links) {
        const neighbour = id && byId.get(id);
        if (neighbour && !seen.has(neighbour.id)) {
          queue.push(neighbour);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
};

/** Заголовок схемы — свободный текст, стоящий прямо над её рамкой. */
const attachTitles = (clusters) => {
  const schemes = clusters.filter((cluster) => cluster.length > 1);
  const loners = clusters.filter(
    (cluster) => cluster.length === 1 && cluster[0].type === "text",
  );
  const used = new Set();

  for (const scheme of schemes) {
    const box = bounds(scheme);
    const title = loners.find((lone) => {
      const [text] = lone;
      if (used.has(text.id)) {
        return false;
      }
      const above = text.y < box.minY && box.minY - text.y < 220;
      const overlaps =
        text.x < box.maxX && text.x + (text.width ?? 0) > box.minX - 80;
      return above && overlaps;
    });
    if (title) {
      used.add(title[0].id);
      scheme.title = title[0].text;
    }
  }
  return {
    schemes,
    notes: loners.filter((lone) => !used.has(lone[0].id)).map(([text]) => text),
  };
};

const labelOf = (element, byId) => {
  if (typeof element.text === "string" && element.text.trim()) {
    return element.text.trim();
  }
  const bound = (element.boundElements ?? []).find((item) => item?.type === "text");
  const text = bound && byId.get(bound.id);
  return text?.text?.trim() ?? "";
};

const readCommand = async (query) => {
  const file = await resolveBoard(query);
  const scene = JSON.parse(await readFile(file, "utf8"));
  const elements = (scene.elements ?? []).filter((element) => !element.isDeleted);
  const byId = new Map(elements.map((element) => [element.id, element]));

  const { schemes, notes } = attachTitles(clusterize(elements));
  schemes.sort((a, b) => bounds(a).minX - bounds(b).minX);

  const lines = [
    `Доска: ${path.basename(file, EXT)}`,
    `Элементов: ${elements.length} · схем: ${schemes.length}`,
    "",
  ];

  schemes.forEach((scheme, index) => {
    const box = bounds(scheme);
    const nodes = scheme.filter(
      (element) => !["arrow", "line", "text"].includes(element.type),
    );
    const arrows = scheme.filter((element) => element.type === "arrow");
    const names = new Map(nodes.map((node, i) => [node.id, `n${index + 1}.${i + 1}`]));

    lines.push(
      `## Схема ${index + 1}${scheme.title ? ` — «${scheme.title}»` : ""}`,
      `   область: x ${Math.round(box.minX)}…${Math.round(box.maxX)}, y ${Math.round(box.minY)}…${Math.round(box.maxY)}`,
      `   узлы (${nodes.length}):`,
    );
    for (const node of nodes) {
      const label = labelOf(node, byId) || "(без подписи)";
      lines.push(
        `     ${names.get(node.id)} [${SHAPES[node.type] ?? node.type}] ${label}`,
      );
    }
    if (arrows.length > 0) {
      lines.push(`   связи (${arrows.length}):`);
      for (const arrow of arrows) {
        const from = arrow.startBinding?.elementId;
        const to = arrow.endBinding?.elementId;
        const label = labelOf(arrow, byId);
        const left = from ? (names.get(from) ?? "?") : "·";
        const right = to ? (names.get(to) ?? "?") : "·";
        lines.push(`     ${left} ${label ? `--${label}-->` : "→"} ${right}`);
      }
    }
    lines.push("");
  });

  if (notes.length > 0) {
    lines.push(`## Отдельные надписи (${notes.length}):`);
    for (const note of notes) {
      const text = note.text.replace(/\s+/g, " ").trim();
      lines.push(`   ${text.length > 160 ? `${text.slice(0, 160)}…` : text}`);
    }
  }

  console.log(lines.join("\n"));
};

const listCommand = async () => {
  const home = await currentFolder();
  for (const dir of await allFolders()) {
    console.log(`${dir}${dir === home ? "   ← текущий проект" : ""}`);
    const boards = await listBoards(dir);
    if (boards.length === 0) {
      console.log("  (пусто)");
    }
    for (const name of boards) {
      const scene = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      const count = (scene.elements ?? []).filter((el) => !el.isDeleted).length;
      console.log(`  ${name.replace(EXT, "")} — ${count} элементов`);
    }
    console.log("");
  }
};

const flag = (argv, name) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};

const sendCommand = async (argv) => {
  const dir = await currentFolder();
  const inbox = path.join(dir, "_inbox");
  await mkdir(inbox, { recursive: true });

  let request;
  const mermaidFile = flag(argv, "mermaid");
  if (mermaidFile) {
    request = {
      mermaid: await readFile(mermaidFile, "utf8"),
      title: flag(argv, "title"),
      anchor: flag(argv, "anchor"),
      // Без явного --place решает приложение: дублировать дефолт здесь значит
      // однажды разойтись с ним и не понять, почему схема легла не туда.
      ...(flag(argv, "place") ? { place: flag(argv, "place") } : {}),
      ...(flag(argv, "gap") ? { gap: Number(flag(argv, "gap")) } : {}),
    };
  } else if (argv[0] && !argv[0].startsWith("--")) {
    request = JSON.parse(await readFile(argv[0], "utf8"));
  } else {
    throw new Error("Нужен файл запроса или --mermaid <файл.mmd>");
  }

  // Запись через переименование: приложение опрашивает ящик каждые полторы
  // секунды и иначе однажды прочитает файл на половине записи.
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const staging = path.join(inbox, `.staging-${stamp}`);
  const target = path.join(inbox, `${stamp}.json`);
  await writeFile(staging, JSON.stringify(request, null, 2), "utf8");
  await rename(staging, target);

  console.log(`Запрос положен: ${target}`);
  console.log(
    `Папка проекта: ${dir}\nПриложение подхватит запрос в течение полутора секунд —` +
      " в этой папке должна быть открыта доска.",
  );
};

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "list") {
    await listCommand();
  } else if (command === "read") {
    await readCommand(rest.join(" "));
  } else if (command === "send") {
    await sendCommand(rest);
  } else {
    console.log(
      [
        "Команды:",
        "  list                      — доски и число элементов",
        "  read <имя доски>          — пересказ доски: схемы, узлы, связи",
        "  send <файл.json>          — положить запрос в ящик",
        "  send --mermaid <файл.mmd> [--title T] [--anchor «текст»] [--place right|below] [--gap 200]",
      ].join("\n"),
    );
    process.exit(command ? 1 : 0);
  }
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exit(1);
}
