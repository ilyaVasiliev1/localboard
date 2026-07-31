import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  Sidebar,
  WelcomeScreen,
  getSceneVersion,
  restoreAppState,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import { invoke } from "@tauri-apps/api/core";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

import {
  boardIcon,
  boardsIcon,
  chevronIcon,
  downloadIcon,
  closeIcon,
  folderIcon,
  pinIcon,
  plusIcon,
  saveIcon,
  sparklesIcon,
} from "./icons";
import { applySchemeRequest } from "./scheme-inbox";
import { checkForUpdates } from "./updates";
import AgentPanel from "./AgentPanel";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

type Board = { name: string; path: string };
type Folder = { name: string; path: string };
type Scene = { elements: any[]; appState: any; files: any };
type AgentSetup = { boardsDir: string; guide: string; cli: string };

const EXT = ".excalidraw";
const BOARDS_SIDEBAR = "boards";
const LAST_BOARD_KEY = "localboard:last-board";
const COLLAPSED_KEY = "localboard:collapsed-folders";
/** Long enough not to thrash the disk, short enough to feel like autosave. */
const SAVE_DEBOUNCE_MS = 1200;

const EMPTY_SCENE: Scene = { elements: [], appState: {}, files: {} };

const boardTitle = (board: Board | null) =>
  board ? board.name.replace(EXT, "") : "";

/** Папка доски — та подключённая, внутри которой лежит её файл. */
const folderOf = (folders: Folder[], board: Board | null) =>
  board
    ? folders.find((item) => board.path.startsWith(`${item.path}/`)) ?? null
    : null;

/**
 * Everything we persist about a scene, boiled down to a comparable string —
 * lets us tell a real edit apart from the `onChange` that `updateScene` and
 * ordinary re-renders emit, so opening a board never rewrites its file.
 */
const sceneSignature = (elements: any[], appState: any) =>
  [
    getSceneVersion(elements),
    elements.length,
    appState?.viewBackgroundColor,
    Math.round(appState?.scrollX ?? 0),
    Math.round(appState?.scrollY ?? 0),
    appState?.zoom?.value,
  ].join("|");

const withExtension = (name: string) =>
  name.endsWith(EXT) ? name : `${name}${EXT}`;

const cx = (...classNames: (string | false | undefined)[]) =>
  classNames.filter(Boolean).join(" ");

/** Cosmetic — never let a failed title update look like a failed open. */
const setWindowTitle = (title: string) => {
  try {
    void getCurrentWindow()
      .setTitle(title)
      .catch(() => undefined);
  } catch {
    // no window to title (e.g. running the UI outside the Tauri shell)
  }
};

class EditorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="editor-error">
        Ошибка редактора: {this.state.error.message}
      </div>
    ) : (
      this.props.children
    );
  }
}

export default function App() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [boards, setBoards] = useState<Record<string, Board[]>>({});
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const [current, setCurrent] = useState<Board | null>(null);
  const [status, setStatus] = useState("Готово");
  const [docked, setDocked] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [newBoardName, setNewBoardName] = useState("Новая доска");
  const [newBoardError, setNewBoardError] = useState("");
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [agentSetup, setAgentSetup] = useState<AgentSetup | null>(null);
  const [agentTheme, setAgentTheme] = useState("light");
  const [renaming, setRenaming] = useState<{
    path: string;
    value: string;
  } | null>(null);

  const needle = filter.trim().toLowerCase();
  const visibleBoards = (directory: string) => {
    const list = boards[directory] ?? [];
    return needle
      ? list.filter((board) => board.name.toLowerCase().includes(needle))
      : list;
  };
  const totalBoards = Object.values(boards).reduce(
    (sum, list) => sum + list.length,
    0
  );
  /** Куда попадёт новая доска: рядом с открытой, иначе в первую подключённую. */
  const activeFolder = folderOf(folders, current) ?? folders[0] ?? null;

  const currentRef = useRef<Board | null>(null);
  const sceneRef = useRef<Scene>(EMPTY_SCENE);
  const saveTimer = useRef<number | undefined>(undefined);
  /** Guards the window between pointing at a new board and its scene landing. */
  const loadingRef = useRef(false);
  /** Signature of what's on disk, so idle re-renders don't trigger saves. */
  const savedSignatureRef = useRef("");

  const toast = useCallback(
    (message: string) => api?.setToast({ message, closable: true }),
    [api]
  );

  const listBoards = useCallback(async (directory: string) => {
    const list = await invoke<Board[]>("list_boards", { directory });
    setBoards((previous) => ({ ...previous, [directory]: list }));
    return list;
  }, []);

  /**
   * Перечитывает список папок и доски в каждой. Папка, которую унесли или
   * переименовали снаружи, отваливается на стороне бэкенда — здесь просто
   * приходит список короче.
   */
  const refreshFolders = useCallback(async () => {
    const list = await invoke<Folder[]>("list_folders");
    setFolders(list);
    const pairs = await Promise.all(
      list.map(async (item) => {
        try {
          return [
            item.path,
            await invoke<Board[]>("list_boards", {
              directory: item.path,
            }),
          ] as const;
        } catch {
          return [item.path, [] as Board[]] as const;
        }
      })
    );
    setBoards(Object.fromEntries(pairs));
    return { folders: list, boards: Object.fromEntries(pairs) };
  }, []);

  const writeBoard = useCallback(async (board: Board, scene: Scene) => {
    setStatus("Сохраняю…");
    await invoke("save_board", {
      path: board.path,
      content: serializeAsJSON(
        scene.elements,
        scene.appState,
        scene.files,
        "local"
      ),
    });
    savedSignatureRef.current = sceneSignature(scene.elements, scene.appState);
    setStatus("Сохранено");
  }, []);

  /** Drops the scene without leaving it attached to a board we no longer have. */
  const clearCanvas = useCallback(() => {
    loadingRef.current = true;
    currentRef.current = null;
    sceneRef.current = EMPTY_SCENE;
    savedSignatureRef.current = "";
    api?.updateScene({
      elements: [],
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    api?.history.clear();
    window.setTimeout(() => {
      loadingRef.current = false;
    }, 0);
  }, [api]);

  /** Writes out a pending debounced save before we move away from a board. */
  const flushPendingSave = useCallback(async () => {
    if (saveTimer.current === undefined) {
      return;
    }
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    if (currentRef.current) {
      await writeBoard(currentRef.current, sceneRef.current);
    }
  }, [writeBoard]);

  const openBoard = useCallback(
    async (board: Board) => {
      if (!api) {
        return;
      }
      await flushPendingSave();
      try {
        const raw = await invoke<string>("read_board", { path: board.path });
        const parsed = JSON.parse(raw);
        const elements = restoreElements(parsed.elements ?? [], null);
        const appState = restoreAppState(parsed.appState ?? {}, null);
        const files = parsed.files ?? {};

        loadingRef.current = true;
        currentRef.current = board;
        sceneRef.current = { elements, appState, files };
        savedSignatureRef.current = sceneSignature(elements, appState);

        api.updateScene({
          elements,
          // Only the per-board view state — theme and the open sidebar belong
          // to the app, not to the file.
          appState: {
            scrollX: appState.scrollX,
            scrollY: appState.scrollY,
            zoom: appState.zoom,
            viewBackgroundColor: appState.viewBackgroundColor,
          },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        api.addFiles(Object.values(files));
        // Undo must not reach back into the board we just left.
        api.history.clear();

        setCurrent(board);
        setStatus("Открыто");
        localStorage.setItem(LAST_BOARD_KEY, board.path);
        setWindowTitle(`LocalBoard — ${boardTitle(board)}`);
      } catch (error) {
        toast(`Не удалось открыть доску: ${error}`);
      } finally {
        // `updateScene` reaches `onChange` asynchronously.
        window.setTimeout(() => {
          loadingRef.current = false;
        }, 0);
      }
    },
    [api, flushPendingSave, toast]
  );

  const onChange = useCallback(
    (elements: any, appState: any, files: any) => {
      sceneRef.current = { elements, appState, files: files ?? {} };
      if (loadingRef.current || !currentRef.current) {
        return;
      }
      // `onChange` fires on every pointer move while drawing. Once a save is
      // already queued we know the scene is dirty, so skip hashing it again —
      // that keeps the per-frame cost at a timer reset even on large boards.
      const alreadyDirty = saveTimer.current !== undefined;
      if (
        !alreadyDirty &&
        sceneSignature(elements, appState) === savedSignatureRef.current
      ) {
        return;
      }
      setStatus("Есть изменения");
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = undefined;
        const board = currentRef.current;
        if (board) {
          void writeBoard(board, sceneRef.current);
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [writeBoard]
  );

  const createBoard = useCallback(async () => {
    const name = newBoardName.trim();
    if (!name) {
      setNewBoardError("Введите название доски");
      return;
    }
    try {
      if (!creating) {
        return;
      }
      const board = await invoke<Board>("create_board", {
        directory: creating,
        name: withExtension(name),
      });
      await listBoards(creating);
      setCreating(null);
      setNewBoardError("");
      setFilter("");
      await openBoard(board);
    } catch (error) {
      setNewBoardError(String(error));
    }
  }, [creating, listBoards, newBoardName, openBoard]);

  const openAgentPanel = useCallback(async () => {
    try {
      setAgentTheme(api?.getAppState().theme ?? "light");
      setAgentSetup(
        await invoke<AgentSetup>("agent_setup", {
          directory: (activeFolder ?? folders[0])?.path ?? "",
        })
      );
    } catch (error) {
      toast(`Не удалось открыть панель: ${error}`);
    }
  }, [activeFolder, api, folders, toast]);

  /**
   * «Сохранить как…» ведёт сразу в системное окно сохранения. Штатный пункт
   * редактора открывает промежуточную панель с выбором способа экспорта, но
   * половина её вариантов — про облако Excalidraw, которого здесь нет, и
   * остаётся лишний шаг перед тем же самым диалогом macOS.
   */
  const saveCopyAs = useCallback(async () => {
    if (!api) {
      return;
    }
    const path = await save({
      defaultPath: `${boardTitle(current) || "Доска"}${EXT}`,
      filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
    });
    if (typeof path !== "string") {
      return;
    }
    try {
      await invoke("write_text", {
        path,
        content: serializeAsJSON(
          api.getSceneElements(),
          api.getAppState(),
          api.getFiles(),
          "local"
        ),
      });
      toast("Копия сохранена");
    } catch (error) {
      toast(`Не удалось сохранить: ${error}`);
    }
  }, [api, current, toast]);

  /**
   * Переименование. Отложенное сохранение сбрасывается на диск ДО переезда
   * файла: иначе таймер дописал бы правки по старому пути и вернул доску под
   * прежним именем — рядом с новой.
   */
  const commitRename = useCallback(
    async (board: Board) => {
      const name = renaming?.value.trim() ?? "";
      setRenaming(null);
      if (!name || name === boardTitle(board)) {
        return;
      }
      try {
        await flushPendingSave();
        const renamed = await invoke<Board>("rename_board", {
          path: board.path,
          name: withExtension(name),
        });
        await listBoards(folderOf(folders, board)?.path ?? "");
        if (currentRef.current?.path === board.path) {
          currentRef.current = renamed;
          setCurrent(renamed);
          localStorage.setItem(LAST_BOARD_KEY, renamed.path);
          setWindowTitle(`LocalBoard — ${boardTitle(renamed)}`);
        }
      } catch (error) {
        toast(`Не удалось переименовать: ${error}`);
      }
    },
    [flushPendingSave, folders, listBoards, renaming, toast]
  );

  /**
   * Удаление доски. Файл уезжает в корзину, но перед этим гасится отложенное
   * автосохранение: таймер, сработавший после удаления, воссоздал бы файл — и
   * доска «удалялась» бы через раз, без всякой закономерности на вид.
   */
  const deleteBoard = useCallback(
    async (board: Board) => {
      const confirmed = await ask(
        `Доска «${boardTitle(board)}» переедет в Корзину.`,
        { title: "Удалить доску?", kind: "warning" }
      );
      if (!confirmed) {
        return;
      }

      const wasOpen = currentRef.current?.path === board.path;
      if (wasOpen) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = undefined;
        currentRef.current = null;
      }

      try {
        await invoke("delete_board", { path: board.path });
        const list = await listBoards(folderOf(folders, board)?.path ?? "");
        if (wasOpen) {
          if (list.length > 0) {
            await openBoard(list[0]);
          } else {
            clearCanvas();
            setCurrent(null);
            setStatus("Готово");
            localStorage.removeItem(LAST_BOARD_KEY);
            setWindowTitle("LocalBoard");
          }
        }
        toast(`Доска «${boardTitle(board)}» в Корзине`);
      } catch (error) {
        toast(`Не удалось удалить: ${error}`);
      }
    },
    [clearCanvas, folders, listBoards, openBoard, toast]
  );

  /**
   * Перенос доски в другую папку. Отложенное сохранение сбрасывается на диск
   * заранее — по той же причине, что и при переименовании: таймер дописал бы
   * правки по старому пути и вернул доску на прежнее место.
   */
  const moveBoard = useCallback(
    async (board: Board, target: Folder) => {
      setDragOver(null);
      const from = folderOf(folders, board);
      if (!from || from.path === target.path) {
        return;
      }
      try {
        await flushPendingSave();
        const moved = await invoke<Board>("move_board", {
          path: board.path,
          directory: target.path,
        });
        await Promise.all([listBoards(from.path), listBoards(target.path)]);
        if (currentRef.current?.path === board.path) {
          currentRef.current = moved;
          setCurrent(moved);
          localStorage.setItem(LAST_BOARD_KEY, moved.path);
        }
        setCollapsed((previous) =>
          previous.filter((path) => path !== target.path),
        );
        toast(`«${boardTitle(board)}» → ${target.name}`);
      } catch (error) {
        toast(`Не удалось перенести: ${error}`);
      }
    },
    [flushPendingSave, folders, listBoards, toast],
  );

  /** Подключение папки: доски остаются там, где лежат, приложение лишь узнаёт о них. */
  const addFolder = useCallback(async () => {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Подключить папку с досками",
    });
    if (typeof picked !== "string") {
      return;
    }
    try {
      await invoke<Folder[]>("add_folder", { path: picked });
      await refreshFolders();
      setCollapsed((previous) => previous.filter((path) => path !== picked));
      setFilter("");
    } catch (error) {
      toast(`Не удалось подключить папку: ${error}`);
    }
  }, [refreshFolders, toast]);

  /**
   * Отключение папки. Ни один файл не трогается — папка исчезает из списка, и
   * только. Поэтому подтверждения здесь нет: обратное действие стоит два клика.
   */
  const removeFolder = useCallback(
    async (target: Folder) => {
      try {
        await invoke<Folder[]>("remove_folder", { path: target.path });
        const next = await refreshFolders();
        // Открытая доска могла жить именно в этой папке.
        if (currentRef.current?.path.startsWith(`${target.path}/`)) {
          window.clearTimeout(saveTimer.current);
          saveTimer.current = undefined;
          clearCanvas();
          setCurrent(null);
          setStatus("Готово");
          localStorage.removeItem(LAST_BOARD_KEY);
          setWindowTitle("LocalBoard");
        }
        toast(
          next.folders.length === 0
            ? "Папка отключена. Подключите другую, чтобы продолжить"
            : `Папка «${target.name}» отключена`
        );
      } catch (error) {
        toast(`Не удалось отключить папку: ${error}`);
      }
    },
    [clearCanvas, refreshFolders, toast]
  );

  // Resolve the boards folder and reopen whatever was open last time.
  useEffect(() => {
    if (!api) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const { boards: byFolder } = await refreshFolders();
      if (cancelled) {
        return;
      }
      const list = Object.values(byFolder).flat();
      const last = localStorage.getItem(LAST_BOARD_KEY);
      const board = list.find((item) => item.path === last) ?? list[0];
      if (board) {
        await openBoard(board);
      } else {
        api.toggleSidebar({ name: BOARDS_SIDEBAR, force: true });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once, as soon as the editor API is available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  /**
   * Ящик схем — в каждой подключённой папке свой. Опрос вместо слежения за
   * файловой системой: цена здесь одно чтение имён каталога, а watcher принёс
   * бы зависимость, права и отдельный класс ошибок ради того же результата.
   */
  useEffect(() => {
    if (!api || folders.length === 0) {
      return;
    }
    let cancelled = false;
    let busy = false;

    const handle = async (directory: string) => {
      const request = await invoke<{ name: string; content: string } | null>(
        "take_scheme_request",
        { directory }
      );
      if (!request || cancelled) {
        return;
      }
      try {
        const board = currentRef.current;
        // Схема живёт в файле доски, поэтому без открытой доски её некуда
        // положить. И класть её в доску ЧУЖОГО проекта тоже нельзя: запрос
        // пришёл из конкретной папки, и ответ должен остаться в ней.
        if (!board) {
          throw new Error("Не открыта доска — схему некуда сохранять");
        }
        if (!board.path.startsWith(`${directory}/`)) {
          throw new Error(
            "Открыта доска из другой папки — откройте доску этого проекта"
          );
        }
        const { count, title } = await applySchemeRequest(api, request.content);
        await invoke("finish_scheme_request", {
          directory,
          name: request.name,
        });
        toast(
          title
            ? `Схема «${title}» добавлена: ${count} элементов`
            : `Схема добавлена: ${count} элементов`
        );
      } catch (error) {
        // Причина уезжает файлом рядом с запросом: тот, кто его положил,
        // работает не в этом окне и консоли приложения не видит.
        await invoke("finish_scheme_request", {
          directory,
          name: request.name,
          error: String(error),
        });
        toast(`Схему добавить не удалось: ${error}`);
      }
    };

    const tick = async () => {
      if (busy || cancelled) {
        return;
      }
      busy = true;
      try {
        for (const item of folders) {
          if (cancelled) {
            break;
          }
          try {
            await handle(item.path);
          } catch {
            // Папку могли отключить между опросами — не повод шуметь тостом
            // каждые полторы секунды.
          }
        }
      } finally {
        busy = false;
      }
    };

    const timer = window.setInterval(tick, 1500);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, folders, toast]);

  /**
   * Нативное меню WKWebView («Обновить», «Назад») к рисованию отношения не
   * имеет и появляется поверх наших собственных меню. В полях ввода его
   * оставляем — там оно даёт копирование и вставку.
   */
  useEffect(() => {
    const block = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("contextmenu", block);
    return () => window.removeEventListener("contextmenu", block);
  }, []);

  /**
   * Ответ системного меню. Слушатель пересоздаётся вместе со списком досок:
   * событие приносит путь, а по нему нужно найти актуальную доску — иначе
   * обработчик держал бы список, каким тот был при первом запуске.
   */
  useEffect(() => {
    const pending = listen<{ action: string; path: string }>(
      "board-menu",
      ({ payload }) => {
        const board = Object.values(boards)
          .flat()
          .find((item) => item.path === payload.path);
        if (!board) {
          return;
        }
        if (payload.action === "rename") {
          setRenaming({ path: board.path, value: boardTitle(board) });
        } else if (payload.action === "delete") {
          void deleteBoard(board);
        }
      }
    );
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, [boards, deleteBoard]);

  useEffect(() => {
    const pending = listen<{ action: string; path: string }>(
      "folder-menu",
      ({ payload }) => {
        const target = folders.find((item) => item.path === payload.path);
        if (target && payload.action === "remove") {
          void removeFolder(target);
        }
      }
    );
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, [folders, removeFolder]);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
  }, [collapsed]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const renderBoardsButton = (appState: { openSidebar?: any }) => {
    const active = appState.openSidebar?.name === BOARDS_SIDEBAR;
    return (
      <button
        type="button"
        className={cx(
          "dropdown-menu-button",
          "localboard-button",
          active && "localboard-button--active"
        )}
        title={current ? `Доски — ${boardTitle(current)}` : "Доски"}
        aria-label="Доски"
        aria-expanded={active}
        onClick={() => api?.toggleSidebar({ name: BOARDS_SIDEBAR })}
      >
        {boardsIcon}
      </button>
    );
  };

  return (
    <div className="shell">
      <EditorBoundary>
        <Excalidraw
          onExcalidrawAPI={setApi}
          langCode="ru-RU"
          name={boardTitle(current) || undefined}
          onChange={onChange}
          renderTopRightUI={(_, appState) => renderBoardsButton(appState)}
          UIOptions={{
            canvasActions: {
              // Boards are opened from our own panel, and saved continuously,
              // so the editor's own open/save-to-file entries would only
              // confuse; "Сохранить как…" stays for exporting a copy.
              loadScene: false,
              saveToActiveFile: false,
              export: { saveFileToDisk: true },
              saveAsImage: true,
              clearCanvas: true,
              toggleTheme: true,
              changeViewBackgroundColor: true,
            },
          }}
        >
          {/* Экран приветствия не нужен: новая доска должна открываться
              чистым холстом. Пустой фрагмент — не то же самое, что отсутствие
              детей: без детей редактор рисует свой экран по умолчанию, а
              выключить его через appState нельзя — он сам включает его обратно
              на каждой пустой доске. */}
          <WelcomeScreen>
            <></>
          </WelcomeScreen>

          <MainMenu>
            <MainMenu.Item
              icon={sparklesIcon}
              onSelect={openAgentPanel}
              aria-label="Работа с Claude"
            >
              Работа с Claude…
            </MainMenu.Item>
            <MainMenu.Item
              icon={downloadIcon}
              onSelect={() => void checkForUpdates((message) => toast(message))}
              aria-label="Проверить обновления"
            >
              Проверить обновления…
            </MainMenu.Item>
            <MainMenu.Item
              icon={saveIcon}
              onSelect={saveCopyAs}
              aria-label="Сохранить как"
            >
              Сохранить как…
            </MainMenu.Item>
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.CommandPalette />
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.Separator />
            {/* Stock preferences minus "box selection mode" — the wrap/overlap
                distinction isn't meaningful for how these boards get used. */}
            <MainMenu.DefaultItems.Preferences>
              <MainMenu.DefaultItems.Preferences.ToggleToolLock />
              <MainMenu.DefaultItems.Preferences.ToggleSnapMode />
              <MainMenu.DefaultItems.Preferences.ToggleGridMode />
              <MainMenu.DefaultItems.Preferences.ToggleZenMode />
              <MainMenu.DefaultItems.Preferences.ToggleViewMode />
              <MainMenu.DefaultItems.Preferences.ToggleElementProperties />
              <MainMenu.DefaultItems.Preferences.ToggleArrowBinding />
              <MainMenu.DefaultItems.Preferences.ToggleMidpointSnapping />
            </MainMenu.DefaultItems.Preferences>
            <MainMenu.DefaultItems.ToggleTheme allowSystemTheme={false} />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>

          <Sidebar
            name={BOARDS_SIDEBAR}
            className="localboard-sidebar"
            docked={docked}
          >
            {/* Our own header: the built-in one ships long tooltips we can't
                shorten, and its close button doesn't land where the button
                that opened the panel was. */}
            <div className="localboard-sidebar__header">
              <h2 className="localboard-sidebar__title">Доски</h2>
              <div className="localboard-sidebar__header-buttons">
                <button
                  type="button"
                  className={cx(
                    "dropdown-menu-button",
                    "localboard-button",
                    docked && "localboard-button--active"
                  )}
                  title="Закрепить"
                  aria-label="Закрепить панель"
                  aria-pressed={docked}
                  onClick={() => setDocked((value) => !value)}
                >
                  {pinIcon}
                </button>
                <button
                  type="button"
                  className="dropdown-menu-button localboard-button"
                  title="Закрыть"
                  aria-label="Закрыть панель"
                  onClick={() => api?.toggleSidebar({ name: null })}
                >
                  {closeIcon}
                </button>
              </div>
            </div>

            <div className="localboard-sidebar__body">
              <input
                className="localboard-input"
                type="search"
                placeholder="Поиск по доскам…"
                aria-label="Поиск по доскам"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && filter) {
                    event.stopPropagation();
                    setFilter("");
                  }
                }}
              />

              <div className="localboard-list">
                {folders.length === 0 && (
                  <p className="localboard-list__empty">
                    Ни одной подключённой папки
                  </p>
                )}
                {needle && totalBoards > 0 && (
                  <p className="localboard-list__empty">
                    {folders.every(
                      (item) => visibleBoards(item.path).length === 0
                    ) && "Ничего не найдено"}
                  </p>
                )}

                {folders.map((item) => {
                  // При поиске папки раскрыты принудительно: иначе найденная
                  // доска прячется внутри свёрнутой секции, и поиск выглядит
                  // сломанным.
                  const folded = !needle && collapsed.includes(item.path);
                  const list = visibleBoards(item.path);
                  return (
                    <section
                      className={cx(
                        "localboard-folder",
                        dragOver === item.path && "localboard-folder--drop",
                      )}
                      key={item.path}
                      onDragOver={(event) => {
                        // Без preventDefault браузер считает область
                        // непринимающей и курсор показывает запрет.
                        event.preventDefault();
                        setDragOver(item.path);
                      }}
                      onDragLeave={() =>
                        setDragOver((current) =>
                          current === item.path ? null : current,
                        )
                      }
                      onDrop={(event) => {
                        event.preventDefault();
                        const path = event.dataTransfer.getData("text/plain");
                        const board = Object.values(boards)
                          .flat()
                          .find((candidate) => candidate.path === path);
                        if (board) {
                          void moveBoard(board, item);
                        } else {
                          setDragOver(null);
                        }
                      }}
                    >
                      <div className="localboard-folder__header">
                        <button
                          type="button"
                          className="localboard-folder__toggle"
                          aria-expanded={!folded}
                          title={item.path}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            void invoke("show_folder_menu", {
                              path: item.path,
                            });
                          }}
                          onClick={() =>
                            setCollapsed((previous) =>
                              previous.includes(item.path)
                                ? previous.filter((path) => path !== item.path)
                                : [...previous, item.path]
                            )
                          }
                        >
                          <span
                            className={cx(
                              "localboard-folder__chevron",
                              folded && "localboard-folder__chevron--folded"
                            )}
                          >
                            {chevronIcon}
                          </span>
                          <span className="localboard-folder__name">
                            {item.name}
                          </span>
                          <span className="localboard-folder__count">
                            {(boards[item.path] ?? []).length}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="dropdown-menu-button localboard-button"
                          title="Новая доска в этой папке"
                          aria-label="Новая доска в этой папке"
                          onClick={() => {
                            setNewBoardName("Новая доска");
                            setNewBoardError("");
                            setCreating(item.path);
                            setCollapsed((previous) =>
                              previous.filter((path) => path !== item.path),
                            );
                          }}
                        >
                          {plusIcon}
                        </button>
                        <button
                          type="button"
                          className="dropdown-menu-button localboard-button"
                          title="Показать в Finder"
                          aria-label="Показать в Finder"
                          onClick={() =>
                            void invoke("reveal_path", { path: item.path })
                          }
                        >
                          {folderIcon}
                        </button>
                      </div>

                      {creating === item.path && (
                        <form
                          className="localboard-new"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void createBoard();
                          }}
                        >
                          <input
                            autoFocus
                            className="localboard-input"
                            value={newBoardName}
                            aria-label="Название доски"
                            onChange={(event) => {
                              setNewBoardName(event.target.value);
                              setNewBoardError("");
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.stopPropagation();
                                setCreating(null);
                              }
                            }}
                          />
                          {newBoardError && (
                            <p className="localboard-new__error">
                              {newBoardError}
                            </p>
                          )}
                          <div className="localboard-new__actions">
                            <button
                              type="button"
                              className="localboard-secondary"
                              onClick={() => setCreating(null)}
                            >
                              Отмена
                            </button>
                            <button
                              type="submit"
                              className="localboard-primary"
                            >
                              Создать
                            </button>
                          </div>
                        </form>
                      )}

                      {!folded && list.length === 0 && creating !== item.path && (
                        <p className="localboard-list__empty">
                          {needle ? "Ничего не найдено" : "Пока нет досок"}
                        </p>
                      )}

                      {!folded &&
                        list.map((board) => {
                          const active = current?.path === board.path;

                          // Переименование прямо в строке списка, как в Finder:
                          // имя правится там же, где читается.
                          if (renaming?.path === board.path) {
                            const value = renaming.value;
                            return (
                              <form
                                key={board.path}
                                className="localboard-rename"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void commitRename(board);
                                }}
                              >
                                <input
                                  autoFocus
                                  className="localboard-input"
                                  aria-label="Название доски"
                                  value={value}
                                  onChange={(event) =>
                                    setRenaming({
                                      path: board.path,
                                      value: event.target.value,
                                    })
                                  }
                                  onBlur={() => void commitRename(board)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Escape") {
                                      event.stopPropagation();
                                      setRenaming(null);
                                    }
                                  }}
                                />
                              </form>
                            );
                          }

                          return (
                            <button
                              type="button"
                              key={board.path}
                              className={cx(
                                "localboard-list__item",
                                active && "localboard-list__item--active"
                              )}
                              aria-current={active}
                              title={boardTitle(board)}
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.setData(
                                  "text/plain",
                                  board.path,
                                );
                                event.dataTransfer.effectAllowed = "move";
                              }}
                              onDragEnd={() => setDragOver(null)}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                void invoke("show_board_menu", {
                                  path: board.path,
                                });
                              }}
                              onClick={() => {
                                if (!active) {
                                  void openBoard(board);
                                }
                                if (!docked) {
                                  api?.toggleSidebar({ name: null });
                                }
                              }}
                            >
                              {boardIcon}
                              <span className="localboard-list__name">
                                {boardTitle(board)}
                              </span>
                            </button>
                          );
                        })}
                    </section>
                  );
                })}
              </div>

              <footer className="localboard-sidebar__footer">
                <span className="localboard-sidebar__status">{status}</span>
                <button
                  type="button"
                  className="localboard-sidebar__folder"
                  title="Подключить папку с досками"
                  onClick={addFolder}
                >
                  {plusIcon}
                  Подключить папку
                </button>
              </footer>
            </div>
          </Sidebar>
        </Excalidraw>
      </EditorBoundary>
      {agentSetup && (
        <AgentPanel
          setup={agentSetup}
          theme={agentTheme}
          onClose={() => setAgentSetup(null)}
        />
      )}
    </div>
  );
}
