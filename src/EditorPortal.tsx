/**
 * Портал в систему стилей редактора.
 *
 * Все стили Excalidraw заскоплены на `.excalidraw`, и элемент, отрисованный
 * вне его контейнера, получает голую разметку без единого правила. Сам редактор
 * решает это так же: заводит для порталов div с классом `excalidraw` в `body`
 * (`hooks/useCreatePortalContainer`). Повторяем — иначе пришлось бы держать
 * копию его оформления для каждого своего меню и окна.
 */
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";

import type { ReactNode } from "react";

export default function EditorPortal({
  children,
  theme,
  className,
}: {
  children: ReactNode;
  theme: string;
  className?: string;
}) {
  const container = useMemo(() => {
    const div = document.createElement("div");
    div.classList.add("excalidraw", ...(className?.split(/\s+/) ?? []));
    div.classList.toggle("theme--dark", theme === "dark");
    return div;
  }, [className, theme]);

  useEffect(() => {
    document.body.appendChild(container);
    return () => container.remove();
  }, [container]);

  return createPortal(children, container);
}
