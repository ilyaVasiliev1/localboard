/**
 * Онбординг «Работа с Claude».
 *
 * Панель отвечает ровно на один вопрос: что человеку сделать руками, чтобы
 * ассистент начал работать с этими досками. Самому ассистенту объяснять ничего
 * не нужно — протокол лежит файлом `CLAUDE.md` в папке досок, и агент, открытый
 * в ней, читает его первым делом. Поэтому здесь три шага, а не описание формата
 * запросов: формат живёт там, где его прочитает тот, кому он адресован.
 */
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { copyIcon, folderIcon } from "./icons";

type AgentSetup = { boardsDir: string; guide: string; cli: string };

export default function AgentPanel({
  setup,
  onClose,
}: {
  setup: AgentSetup;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const command = `cd "${setup.boardsDir}" && claude`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Буфер может быть недоступен — команда всё равно видна и выделяется.
    }
  };

  return (
    <div
      className="localboard-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Работа с Claude"
      onClick={onClose}
    >
      <div className="localboard-modal__card" onClick={(e) => e.stopPropagation()}>
        <header className="localboard-modal__header">
          <h2 className="localboard-modal__title">Работа с Claude</h2>
          <button
            type="button"
            className="localboard-secondary"
            onClick={onClose}
            autoFocus
          >
            Закрыть
          </button>
        </header>

        <p className="localboard-modal__lead">
          Claude умеет читать эти доски и рисовать на них схемы: «нарисуй схему
          авторизации правее вот этой», «прочитай доску и скажи, чего в схеме не
          хватает». Инструкция для него уже лежит в папке досок — объяснять
          формат руками не нужно.
        </p>

        <ol className="localboard-steps">
          <li>
            <b>Поставь Claude Code</b>, если его ещё нет:
            <code className="localboard-code">
              npm install -g @anthropic-ai/claude-code
            </code>
          </li>
          <li>
            <b>Запусти его в папке досок</b> — именно в ней, иначе он не увидит
            инструкцию:
            <code className="localboard-code">{command}</code>
            <button type="button" className="localboard-secondary" onClick={copy}>
              {copyIcon}
              {copied ? "Скопировано" : "Скопировать команду"}
            </button>
          </li>
          <li>
            <b>Скажи словами, что нужно.</b> Схема появится на открытой доске
            сама, в течение пары секунд — её можно двигать и править как любую
            свою, а Cmd+Z отменяет вставку целиком.
          </li>
        </ol>

        <p className="localboard-modal__note">
          Схемы приходят чёрно-белыми: цвет на доске означает смысл, и
          расставлять его — дело хозяина доски. Приложение при этом должно быть
          открыто, а доска выбрана — иначе схему некуда положить.
        </p>

        <footer className="localboard-modal__footer">
          <button
            type="button"
            className="localboard-secondary"
            onClick={() => void invoke("reveal_path", { path: setup.boardsDir })}
          >
            {folderIcon}
            Открыть папку досок
          </button>
          <span className="localboard-modal__path" title={setup.guide}>
            {setup.guide}
          </span>
        </footer>
      </div>
    </div>
  );
}
