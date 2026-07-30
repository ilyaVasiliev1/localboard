/**
 * Онбординг «Работа с Claude».
 *
 * Разметка и классы — те же, что у собственных диалогов редактора
 * (`components/Dialog.tsx` + `Modal.tsx` в апстриме): портал в `body` с
 * классами `excalidraw excalidraw-modal-container`, внутри `Modal` → `Island` →
 * `Dialog__title` / `Dialog__content`. Компонент `Dialog` пакет наружу не
 * отдаёт, поэтому повторяется его структура — так окно получает готовые стили
 * редактора вместо параллельного оформления, и справка с этой панелью
 * выглядят одинаково.
 *
 * Отсюда же поведение: закрытие по Esc и клику вне окна, без кнопки-крестика.
 * На десктопе редактор её не рисует ни в одном своём диалоге.
 *
 * Панель отвечает на один вопрос: что сделать руками, чтобы ассистент начал
 * работать с досками. Самому ассистенту объяснять нечего — протокол лежит
 * файлом `CLAUDE.md` в папке досок, и агент, открытый в ней, читает его сам.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type AgentSetup = { boardsDir: string; guide: string; cli: string };

export default function AgentPanel({
  setup,
  theme,
  onClose,
}: {
  setup: AgentSetup;
  theme: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const command = `cd "${setup.boardsDir}" && claude`;

  const container = useMemo(() => {
    const div = document.createElement("div");
    div.classList.add("excalidraw", "excalidraw-modal-container");
    div.classList.toggle("theme--dark", theme === "dark");
    return div;
  }, [theme]);

  useEffect(() => {
    document.body.appendChild(container);
    return () => container.remove();
  }, [container]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    // Перехват на фазе погружения: иначе Escape сначала достаётся холсту.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Буфер может быть недоступен — команду всё равно видно и выделяется.
    }
  };

  return createPortal(
    <div
      className="Modal Dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="localboard-agent-title"
    >
      <div className="Modal__background" onClick={onClose} />
      <div
        className="Modal__content"
        style={{ "--max-width": "550px" } as React.CSSProperties}
        tabIndex={0}
      >
        <div className="Island">
          <h2 id="localboard-agent-title" className="Dialog__title">
            <span className="Dialog__titleContent">Работа с Claude</span>
          </h2>
          <div className="Dialog__content">
            <p className="localboard-agent__lead">
              Claude умеет читать эти доски и рисовать на них схемы: «нарисуй
              схему авторизации правее вот этой», «прочитай доску и скажи, чего
              не хватает». Инструкция для него уже лежит в папке досок.
            </p>

            <ol className="localboard-agent__steps">
              <li>
                Поставьте Claude Code, если его ещё нет:
                <button
                  type="button"
                  className="localboard-agent__command"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      "npm install -g @anthropic-ai/claude-code",
                    )
                  }
                  title="Нажмите, чтобы скопировать"
                >
                  npm install -g @anthropic-ai/claude-code
                </button>
              </li>
              <li>
                Запустите его <b>в папке досок</b> — иначе он не увидит
                инструкцию:
                <button
                  type="button"
                  className="localboard-agent__command"
                  onClick={copy}
                  title="Нажмите, чтобы скопировать"
                >
                  {command}
                </button>
                {copied && (
                  <span className="localboard-agent__hint">Скопировано</span>
                )}
              </li>
              <li>
                Скажите словами, что нужно. Схема появится на открытой доске
                сама — её можно двигать и править как свою, Cmd+Z отменяет
                вставку целиком.
              </li>
            </ol>

            <p className="localboard-agent__note">
              Схемы приходят чёрно-белыми: цвет означает смысл, и расставлять
              его — дело хозяина доски.
            </p>
          </div>
        </div>
      </div>
    </div>,
    container,
  );
}
