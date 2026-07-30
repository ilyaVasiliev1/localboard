/**
 * File System Access API, backed by Tauri.
 *
 * Excalidraw saves and opens files through `browser-fs-access`, which picks
 * its strategy once at load time: if `window.showOpenFilePicker` exists it
 * uses the File System Access API, otherwise it falls back to an `<a download>`
 * link. WKWebView has neither a real picker nor working downloads, so exports
 * quietly went nowhere.
 *
 * Implementing just enough of the API here routes every save through the
 * native macOS dialog and lets Rust write the bytes. This module must be
 * imported before the editor so the feature detection sees it.
 */
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

type PickerType = { description?: string; accept?: Record<string, string[]> };
type PickerOptions = {
  suggestedName?: string;
  types?: PickerType[];
  multiple?: boolean;
};

const abort = () =>
  new DOMException("The user aborted a request.", "AbortError");

const baseName = (path: string) => path.split("/").pop() ?? path;

/** `{ "image/png": [".png"] }` → `[{ name, extensions: ["png"] }]` */
const toFilters = (types: PickerType[] = []) =>
  types
    .map((type) => ({
      name: type.description || "Файлы",
      extensions: Object.values(type.accept ?? {})
        .flat()
        .map((extension) => extension.replace(/^\./, "")),
    }))
    .filter((filter) => filter.extensions.length > 0);

const mimeFor = (types: PickerType[] = [], name: string) => {
  const extension = name.includes(".") ? `.${name.split(".").pop()}` : "";
  for (const type of types) {
    for (const [mime, extensions] of Object.entries(type.accept ?? {})) {
      if (mime !== "*/*" && extensions.includes(extension)) {
        return mime;
      }
    }
  }
  return "";
};

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });

const saveHandle = (path: string) => ({
  kind: "file" as const,
  name: baseName(path),
  /**
   * `browser-fs-access` probes a reused handle with `getFile()` before writing
   * to it. We can't hand back a live handle across app restarts, so decline
   * and let it fall through to a fresh picker.
   */
  getFile: () =>
    Promise.reject(new DOMException("File not found.", "NotFoundError")),
  createWritable: async () => {
    const chunks: BlobPart[] = [];
    return {
      write: async (data: BlobPart | { data?: BlobPart }) => {
        // The spec allows `{ type: "write", data }`; Excalidraw sends raw data.
        const payload =
          data && typeof data === "object" && "data" in data ? data.data : data;
        if (payload != null) {
          chunks.push(payload as BlobPart);
        }
      },
      close: async () => {
        await invoke("write_base64", {
          path,
          data: await toBase64(new Blob(chunks)),
        });
      },
      abort: async () => undefined,
    };
  },
});

const openHandle = (path: string, types: PickerType[] = []) => ({
  kind: "file" as const,
  name: baseName(path),
  getFile: async () => {
    const data = await invoke<string>("read_base64", { path });
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], baseName(path), {
      type: mimeFor(types, path),
    });
  },
});

const showSaveFilePicker = async (options: PickerOptions = {}) => {
  const path = await save({
    defaultPath: options.suggestedName,
    filters: toFilters(options.types),
  });
  if (!path) {
    throw abort();
  }
  return saveHandle(path);
};

const showOpenFilePicker = async (options: PickerOptions | PickerOptions[] = {}) => {
  const opts = Array.isArray(options) ? options[0] ?? {} : options;
  const picked = await open({
    multiple: opts.multiple ?? false,
    filters: toFilters(opts.types),
  });
  if (picked == null) {
    throw abort();
  }
  const paths = Array.isArray(picked) ? picked : [picked];
  return paths.map((path) => openHandle(path, opts.types));
};

// Install only inside the app. A plain browser (`npm run dev`) has no Tauri
// bridge to write through, and there its own pickers work fine.
const target = window as unknown as Record<string, unknown>;
if (target.__TAURI_INTERNALS__) {
  target.showSaveFilePicker = showSaveFilePicker;
  target.showOpenFilePicker = showOpenFilePicker;
}
