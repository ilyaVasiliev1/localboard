#!/usr/bin/env node
/**
 * Картинка доски без запуска приложения:
 *
 *   node scripts/preview.mjs "Имя доски" [файл.png]
 *
 * Нужна для проверки правок глазами. Пересказ показывает связи и числа, но по
 * ним не видно того, ради чего схему вообще рисуют: не наехали ли блоки друг на
 * друга, не пошла ли связь через полсхемы, ровно ли встала вставка. Открывать
 * ради этого приложение и снимать экран нельзя — там чужая работа.
 *
 * Рисуется геометрия из файла как есть: у стрелок в нём лежат все точки
 * излома, поэтому маршрут связи на картинке настоящий, а не пересчитанный
 * заново. Чего здесь нет — фирменной «рисованности» линий: она в раскладке
 * ничего не решает, а повторять её значит писать второй редактор.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const CONFIG = path.join(
  homedir(),
  "Library/Application Support/com.localboard.local/config.json",
);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EXT = ".excalidraw";
const PAD = 48;

const escape = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const findBoard = async (query) => {
  const config = JSON.parse(await readFile(CONFIG, "utf8"));
  const needle = query.toLowerCase().replace(EXT, "");
  for (const dir of config.folders ?? []) {
    if (!existsSync(dir)) {
      continue;
    }
    const names = (await readdir(dir)).filter((name) => name.endsWith(EXT));
    const match =
      names.find((name) => name.replace(EXT, "").toLowerCase() === needle) ??
      names.find((name) => name.toLowerCase().includes(needle));
    if (match) {
      return path.join(dir, match);
    }
  }
  throw new Error(`Доска «${query}» не найдена`);
};

/** Габариты элемента с учётом точек — у стрелки размер живёт в них. */
const extent = (element) => {
  const xs = [element.x, element.x + (element.width ?? 0)];
  const ys = [element.y, element.y + (element.height ?? 0)];
  for (const [dx, dy] of element.points ?? []) {
    xs.push(element.x + dx);
    ys.push(element.y + dy);
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

const polyline = (points) =>
  points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");

/** Тот же маршрут, но каждый излом срезан дугой — как рисует редактор. */
const rounded = (points, radius = 12) => {
  const parts = [`M${points[0][0]},${points[0][1]}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const back = Math.min(radius, Math.hypot(cx - px, cy - py) / 2);
    const fwd = Math.min(radius, Math.hypot(nx - cx, ny - cy) / 2);
    const ax = cx + Math.sign(px - cx) * back;
    const ay = cy + Math.sign(py - cy) * back;
    const bx = cx + Math.sign(nx - cx) * fwd;
    const by = cy + Math.sign(ny - cy) * fwd;
    parts.push(`L${ax},${ay}`, `Q${cx},${cy} ${bx},${by}`);
  }
  const last = points[points.length - 1];
  parts.push(`L${last[0]},${last[1]}`);
  return parts.join(" ");
};

const shapeOf = (element) => {
  const fill = element.backgroundColor === "transparent" ? "none" : element.backgroundColor;
  const common = `fill="${fill}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}"${
    element.strokeStyle === "dashed" ? ' stroke-dasharray="10 8"' : ""
  }`;
  const { x, y, width: w, height: h } = element;

  switch (element.type) {
    case "rectangle":
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${element.roundness ? 16 : 0}" ${common}/>`;
    case "ellipse":
      return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${common}/>`;
    case "diamond":
      return `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${common}/>`;
    case "arrow":
    case "line": {
      const points = (element.points ?? []).map(([dx, dy]) => [x + dx, y + dy]);
      if (points.length < 2) {
        return "";
      }
      // Прямоугольная связь рисуется со скруглёнными углами — так её рисует и
      // редактор. Без этого картинка для осмотра врёт: острый угол на ней
      // выглядит дефектом, которого на экране нет.
      const line = `<path d="${element.elbowed ? rounded(points) : polyline(points)}" fill="none" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" stroke-linejoin="round"/>`;
      if (element.type === "line") {
        return line;
      }
      // Наконечник по направлению последнего отрезка — по нему видно, куда
      // связь смотрит, а это половина смысла схемы.
      const [ax, ay] = points[points.length - 2];
      const [bx, by] = points[points.length - 1];
      const angle = Math.atan2(by - ay, bx - ax);
      const wing = (turn) =>
        `${bx - 14 * Math.cos(angle - turn)},${by - 14 * Math.sin(angle - turn)}`;
      return `${line}<polyline points="${wing(0.45)} ${bx},${by} ${wing(-0.45)}" fill="none" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" stroke-linejoin="round"/>`;
    }
    case "text": {
      const size = element.fontSize ?? 20;
      const lines = String(element.text ?? "").split("\n");
      const step = size * 1.25;
      return lines
        .map(
          (line, index) =>
            `<text x="${element.x + (element.textAlign === "center" ? element.width / 2 : 0)}" y="${
              element.y + step * (index + 0.8)
            }" font-family="Helvetica, Arial, sans-serif" font-size="${size}" fill="${element.strokeColor}" text-anchor="${
              element.textAlign === "center" ? "middle" : "start"
            }">${escape(line)}</text>`,
        )
        .join("");
    }
    default:
      return "";
  }
};

const render = async (query, output) => {
  const file = await findBoard(query);
  const scene = JSON.parse(await readFile(file, "utf8"));
  const elements = (scene.elements ?? []).filter((element) => !element.isDeleted);
  if (elements.length === 0) {
    throw new Error("Доска пуста — рисовать нечего");
  }

  const box = elements.map(extent).reduce((all, one) => ({
    minX: Math.min(all.minX, one.minX),
    minY: Math.min(all.minY, one.minY),
    maxX: Math.max(all.maxX, one.maxX),
    maxY: Math.max(all.maxY, one.maxY),
  }));
  const width = Math.ceil(box.maxX - box.minX + PAD * 2);
  const height = Math.ceil(box.maxY - box.minY + PAD * 2);

  // Подписи рисуются последними: иначе заливка соседнего блока может лечь
  // поверх текста, и на картинке это выглядело бы дефектом схемы.
  const order = [...elements].sort(
    (a, b) => (a.type === "text" ? 1 : 0) - (b.type === "text" ? 1 : 0),
  );
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${box.minX - PAD} ${box.minY - PAD} ${width} ${height}">` +
    `<rect x="${box.minX - PAD}" y="${box.minY - PAD}" width="${width}" height="${height}" fill="#ffffff"/>` +
    order.map(shapeOf).join("") +
    "</svg>";

  const page = path.join(tmpdir(), `board-${process.pid}.html`);
  await writeFile(
    page,
    `<body style="margin:0">${svg}</body>`,
    "utf8",
  );
  await run(CHROME, [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    `--window-size=${width},${height}`,
    `--screenshot=${output}`,
    `file://${page}`,
  ]);
  console.log(`${output} — ${width}x${height}, элементов: ${elements.length}`);
};

const [query, output] = process.argv.slice(2);
try {
  if (!query) {
    throw new Error("Нужно имя доски");
  }
  await render(query, path.resolve(output ?? "board.png"));
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exit(1);
}
