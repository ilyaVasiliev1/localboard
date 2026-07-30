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
  getSceneVersion,
  restoreAppState,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  boardIcon,
  boardsIcon,
  closeIcon,
  importIcon,
  pinIcon,
  plusIcon,
} from "./icons";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

type Board = { name: string; path: string };
type Scene = { elements: any[]; appState: any; files: any };

const EXT = ".excalidraw";
const BOARDS_SIDEBAR = "boards";
const LAST_BOARD_KEY = "localboard:last-board";
/** Long enough not to thrash the disk, short enough to feel like autosave. */
const SAVE_DEBOUNCE_MS = 1200;

const EMPTY_SCENE: Scene = { elements: [], appState: {}, files: {} };

const boardTitle = (board: Board | null) =>
  board ? board.name.replace(EXT, "") : "";

const folderTitle = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

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
  const [folder, setFolder] = useState("");
  const [boards, setBoards] = useState<Board[]>([]);
  const [current, setCurrent] = useState<Board | null>(null);
  const [status, setStatus] = useState("Готово");
  const [docked, setDocked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newBoardName, setNewBoardName] = useState("Новая доска");
  const [newBoardError, setNewBoardError] = useState("");
  const [filter, setFilter] = useState("");

  const needle = filter.trim().toLowerCase();
  const visibleBoards = needle
    ? boards.filter((board) => board.name.toLowerCase().includes(needle))
    : boards;

  const currentRef = useRef<Board | null>(null);
  const sceneRef = useRef<Scene>(EMPTY_SCENE);
  const saveTimer = useRef<number | undefined>(undefined);
  /** Guards the window between pointing at a new board and its scene landing. */
  const loadingRef = useRef(false);
  /** Signature of what's on disk, so idle re-renders don't trigger saves. */
  const savedSignatureRef = useRef("");

  const toast = useCallback(
    (message: string) => api?.setToast({ message, closable: true }),
    [api],
  );

  const listBoards = useCallback(async (directory: string) => {
    const list = await invoke<Board[]>("list_boards", { directory });
    setBoards(list);
    return list;
  }, []);

  const writeBoard = useCallback(async (board: Board, scene: Scene) => {
    setStatus("Сохраняю…");
    await invoke("save_board", {
      path: board.path,
      content: serializeAsJSON(
        scene.elements,
        scene.appState,
        scene.files,
        "local",
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
    [api, flushPendingSave, toast],
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
    [writeBoard],
  );

  const createBoard = useCallback(async () => {
    const name = newBoardName.trim();
    if (!name) {
      setNewBoardError("Введите название доски");
      return;
    }
    try {
      const board = await invoke<Board>("create_board", {
        directory: folder,
        name: withExtension(name),
      });
      await listBoards(folder);
      setCreating(false);
      setNewBoardError("");
      setFilter("");
      await openBoard(board);
    } catch (error) {
      setNewBoardError(String(error));
    }
  }, [folder, listBoards, newBoardName, openBoard]);

  const importBoard = useCallback(async () => {
    const source = await open({
      multiple: false,
      title: "Импортировать доску",
      filters: [{ name: "Excalidraw", extensions: ["excalidraw", "json"] }],
    });
    if (typeof source !== "string") {
      return;
    }
    try {
      const board = await invoke<Board>("import_board", {
        directory: folder,
        source,
      });
      await listBoards(folder);
      await openBoard(board);
      toast(`Доска «${boardTitle(board)}» добавлена в список`);
    } catch (error) {
      toast(`Не удалось импортировать файл: ${error}`);
    }
  }, [folder, listBoards, openBoard, toast]);

  const chooseFolder = useCallback(async () => {
    const picked = await open({
      directory: true,
      multiple: false,
      defaultPath: folder || undefined,
      title: "Папка досок",
    });
    if (typeof picked !== "string") {
      return;
    }
    await flushPendingSave();
    try {
      const directory = await invoke<string>("set_board_directory", {
        directory: picked,
      });
      setFolder(directory);
      const list = await listBoards(directory);
      setFilter("");
      setCreating(false);
      api?.toggleSidebar({ name: BOARDS_SIDEBAR, force: true });

      // The board that was open lives in the previous folder.
      if (list.length > 0) {
        await openBoard(list[0]);
      } else {
        clearCanvas();
        setCurrent(null);
        setStatus("Готово");
        localStorage.removeItem(LAST_BOARD_KEY);
        setWindowTitle("LocalBoard");
      }
    } catch (error) {
      toast(`Не удалось сменить папку: ${error}`);
    }
  }, [api, clearCanvas, flushPendingSave, folder, listBoards, openBoard, toast]);

  // Resolve the boards folder and reopen whatever was open last time.
  useEffect(() => {
    if (!api) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const directory = await invoke<string>("get_board_directory");
      if (cancelled) {
        return;
      }
      setFolder(directory);
      const list = await listBoards(directory);
      if (cancelled) {
        return;
      }
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

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const renderBoardsButton = (appState: { openSidebar?: any }) => {
    const active = appState.openSidebar?.name === BOARDS_SIDEBAR;
    return (
      <button
        type="button"
        className={cx(
          "dropdown-menu-button",
          "localboard-button",
          active && "localboard-button--active",
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
          <MainMenu>
            <MainMenu.Item
              icon={importIcon}
              onSelect={importBoard}
              aria-label="Импортировать доску"
            >
              Импортировать доску…
            </MainMenu.Item>
            <MainMenu.DefaultItems.Export />
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
              <button
                type="button"
                className="localboard-primary"
                onClick={() => {
                  setNewBoardName("Новая доска");
                  setNewBoardError("");
                  setCreating(true);
                }}
              >
                {plusIcon}
                Новая доска
              </button>
              <div className="localboard-sidebar__header-buttons">
                <button
                  type="button"
                  className={cx(
                    "dropdown-menu-button",
                    "localboard-button",
                    docked && "localboard-button--active",
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
              {creating ? (
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
                        setCreating(false);
                      }
                    }}
                  />
                  {newBoardError && (
                    <p className="localboard-new__error">{newBoardError}</p>
                  )}
                  <div className="localboard-new__actions">
                    <button
                      type="button"
                      className="localboard-secondary"
                      onClick={() => setCreating(false)}
                    >
                      Отмена
                    </button>
                    <button type="submit" className="localboard-primary">
                      Создать
                    </button>
                  </div>
                </form>
              ) : (
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
              )}

              <div className="localboard-list">
                {visibleBoards.length === 0 && !creating && (
                  <p className="localboard-list__empty">
                    {boards.length === 0
                      ? "В этой папке пока нет досок"
                      : "Ничего не найдено"}
                  </p>
                )}
                {visibleBoards.map((board) => {
                  const active = current?.path === board.path;
                  return (
                    <button
                      type="button"
                      key={board.path}
                      className={cx(
                        "localboard-list__item",
                        active && "localboard-list__item--active",
                      )}
                      aria-current={active}
                      title={boardTitle(board)}
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
              </div>

              <footer className="localboard-sidebar__footer">
                <span className="localboard-sidebar__status">{status}</span>
                <button
                  type="button"
                  className="localboard-sidebar__folder"
                  title={`Папка досок: ${folder}`}
                  onClick={chooseFolder}
                >
                  {folderTitle(folder)}
                </button>
              </footer>
            </div>
          </Sidebar>
        </Excalidraw>
      </EditorBoundary>
    </div>
  );
}
