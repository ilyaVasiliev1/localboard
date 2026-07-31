/**
 * Обновление приложения — только по явному нажатию.
 *
 * Приложение обещает полный офлайн, и это обещание держится буквально: в самом
 * интерфейсе сеть запрещена политикой безопасности (`connect-src 'none'`).
 * Проверку выполняет Rust, а не веб-часть, поэтому запрет остаётся в силе —
 * страница по-прежнему не может обратиться наружу ни при каких обстоятельствах,
 * а единственный сетевой запрос за всю жизнь приложения человек делает сам,
 * нажав пункт меню.
 *
 * Доски обновление не трогает: заменяется бандл приложения в «Программах»,
 * а доски лежат в папках пользователя и к бандлу отношения не имеют.
 */
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";

/**
 * `sticky` — сообщение висит, пока его не сменит следующее.
 *
 * Обычная плашка редактора гаснет через пять секунд, а ответ GitHub идёт
 * заметно дольше — из Китая счёт шёл на десятки секунд. Получалось худшее из
 * возможного: человек нажимает, плашка гаснет, и дальше тишина, по которой
 * невозможно отличить «идёт проверка» от «ничего не произошло».
 */
type Report = (message: string, sticky?: boolean) => void;

/** Столько ждём GitHub, прежде чем сказать, что он не отвечает. */
const CHECK_TIMEOUT_MS = 45_000;

/** Сетевую ошибку человеку нужно объяснить одной фразой, а не стектрейсом. */
const isOffline = (error: unknown) => {
  const text = String(error).toLowerCase();
  return (
    text.includes("network") ||
    text.includes("dns") ||
    text.includes("connection") ||
    text.includes("timed out") ||
    text.includes("offline") ||
    text.includes("resolve")
  );
};

export const checkForUpdates = async (report: Report) => {
  report("Проверяю обновления…", true);

  let update;
  try {
    update = await check({ timeout: CHECK_TIMEOUT_MS });
  } catch (error) {
    const text = String(error).toLowerCase();
    report(
      text.includes("timed out") || text.includes("timeout")
        ? "GitHub не ответил за 45 секунд — попробуйте позже"
        : isOffline(error)
          ? "Нет соединения с интернетом — проверить обновления не получилось"
          : `Не удалось проверить обновления: ${error}`,
    );
    return;
  }

  if (!update) {
    report("Установлена последняя версия");
    return;
  }

  const confirmed = await ask(
    `Доступна версия ${update.version}. Приложение скачает и установит её, затем перезапустится. Доски не затрагиваются.`,
    { title: "Обновить LocalBoard?", kind: "info", okLabel: "Обновить" },
  );
  if (!confirmed) {
    return;
  }

  try {
    let total = 0;
    let received = 0;
    await update.downloadAndInstall((event) => {
      // Прогресс в процентах — единственная честная форма: размер обновления
      // человеку ни о чём не говорит, а ожидание без отклика выглядит зависанием.
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
        report("Загружаю обновление…", true);
      } else if (event.event === "Progress") {
        received += event.data.chunkLength;
        if (total > 0) {
          report(
            `Загружаю обновление… ${Math.round((received / total) * 100)}%`,
            true,
          );
        }
      } else if (event.event === "Finished") {
        report("Устанавливаю…", true);
      }
    });
    await relaunch();
  } catch (error) {
    report(
      isOffline(error)
        ? "Связь прервалась — обновление не установлено, приложение не пострадало"
        : `Не удалось установить обновление: ${error}`,
    );
  }
};
