/**
 * Icons for LocalBoard's own UI.
 *
 * Excalidraw doesn't export its icon set, so we mirror its factory and its
 * tabler-icons defaults verbatim (see `components/icons.tsx` upstream). That
 * keeps our buttons visually indistinguishable from the editor's own.
 */
import type { ReactNode, SVGProps } from "react";

type Opts = { width?: number; height?: number } & SVGProps<SVGSVGElement>;

const createIcon = (d: ReactNode, opts: Opts = {}) => {
  const { width = 512, height = width, ...rest } = opts;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      {...rest}
    >
      {d}
    </svg>
  );
};

const tablerIconProps: Opts = {
  width: 24,
  height: 24,
  fill: "none",
  strokeWidth: 2,
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

// tabler-icons: layout-grid
export const boardsIcon = createIcon(
  <g strokeWidth={1.5}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M4 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
    <path d="M14 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
    <path d="M4 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
    <path d="M14 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
  </g>,
  tablerIconProps,
);

// tabler-icons: plus
export const plusIcon = createIcon(
  <g strokeWidth={1.5}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </g>,
  tablerIconProps,
);

// tabler-icons: file-import
export const importIcon = createIcon(
  <g strokeWidth={1.5}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M5 13v-8a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2h-5.5" />
    <path d="M2 19h7" />
    <path d="M6 16l3 3l-3 3" />
  </g>,
  tablerIconProps,
);

// tabler-icons: pin (keeps the panel open)
export const pinIcon = createIcon(
  <g strokeWidth={1.5}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M9 4v6l-2 4v2h10v-2l-2 -4v-6" />
    <line x1="12" y1="16" x2="12" y2="21" />
    <line x1="8" y1="4" x2="16" y2="4" />
  </g>,
  tablerIconProps,
);

export const closeIcon = createIcon(
  <g strokeWidth={1.5}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M18 6l-12 12" />
    <path d="M6 6l12 12" />
  </g>,
  tablerIconProps,
);

// tabler-icons: layout-board (a single board in the list)
export const boardIcon = createIcon(
  <g strokeWidth={1.5}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M4 4m0 1a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1z" />
    <path d="M4 12h8" />
    <path d="M12 8h8" />
    <path d="M12 4v16" />
  </g>,
  tablerIconProps,
);

// tabler-icons: sparkles (работа с ИИ-ассистентом)
export const sparklesIcon = createIcon(
  <g strokeWidth={1.5}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z" />
  </g>,
  tablerIconProps,
);

// tabler-icons: copy
export const copyIcon = createIcon(
  <g strokeWidth={1.5}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z" />
    <path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" />
  </g>,
  tablerIconProps,
);

// tabler-icons: folder-open
export const folderIcon = createIcon(
  <g strokeWidth={1.5}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2" />
  </g>,
  tablerIconProps,
);

// tabler-icons: download (сохранить копию файлом)
export const saveIcon = createIcon(
  <g strokeWidth={1.5}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
    <path d="M7 11l5 5l5 -5" />
    <path d="M12 4l0 12" />
  </g>,
  tablerIconProps,
);
