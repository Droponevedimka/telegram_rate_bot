import { BOT_ADMIN_IDS, TARGET_CHAT_ID } from "../config.mjs";
import { createTelegramBot } from "./telegramClient.mjs";
import { runExchangeRateCheck } from "./exchangeRate.mjs";

const bot = createTelegramBot();
const ADMIN_CACHE_TTL_MS = 5 * 60 * 1000;

let adminCache = {
  expiresAt: 0,
  ids: BOT_ADMIN_IDS,
};

function formatRateValue(rawRate) {
  if (typeof rawRate !== "number" || !Number.isFinite(rawRate)) {
    return "нет данных";
  }

  return `${rawRate.toFixed(2).replace(".", ",")} ₽`;
}

function buildManualUpdateReply(result) {
  const sourceDate = result.sourceDate || "нет данных";
  const previousRate = formatRateValue(result.previousRate);
  const currentRate = formatRateValue(result.currentRate);

  if (result.action === "failed") {
    return [
      "Обновление курса завершилось с ошибкой.",
      `Дата курса API: ${sourceDate}`,
      `Курс до: ${previousRate}`,
      `Курс после: ${currentRate}`,
      `Ошибка: ${result.errorMessage || "неизвестно"}`,
    ].join("\n");
  }

  const actionMap = {
    updated: "Курс обновлён, опубликован новый пост.",
    rotated: "Курс перепубликован новым постом.",
    unchanged: "API вернул актуальные данные, но курс не изменился.",
    not_modified: "API не изменился, публикация не потребовалась.",
    noop: "Изменений не обнаружено.",
  };

  return [
    actionMap[result.action] || "Обновление выполнено.",
    `Дата курса API: ${sourceDate}`,
    `Last-Modified: ${result.lastModified || "нет данных"}`,
    `Курс до: ${previousRate}`,
    `Курс после: ${currentRate}`,
    `Удалены сообщения: ${result.deletedMessageIds?.length ? result.deletedMessageIds.join(", ") : "нет"}`,
  ].join("\n");
}

async function getAdminIds() {
  if (adminCache.expiresAt > Date.now() && adminCache.ids.length > 0) {
    return adminCache.ids;
  }

  const administrators = await bot.telegram.getChatAdministrators(TARGET_CHAT_ID);
  const ids = [...new Set([...BOT_ADMIN_IDS, ...administrators.map((item) => item.user.id)])];

  adminCache = {
    ids,
    expiresAt: Date.now() + ADMIN_CACHE_TTL_MS,
  };

  return ids;
}

async function isAdminUser(userId) {
  if (!userId) {
    return false;
  }

  const adminIds = await getAdminIds();
  return adminIds.includes(userId);
}

bot.start(async (ctx) => {
  await ctx.reply(
    "Доступная команда: /update_cur\nКоманда доступна только администраторам целевого чата."
  );
});

bot.help(async (ctx) => {
  await ctx.reply(
    "Команды:\n/update_cur - вручную обновить курс и получить отчёт по обновлению."
  );
});

bot.command("update_cur", async (ctx) => {
  try {
    const allowed = await isAdminUser(ctx.from?.id);

    if (!allowed) {
      await ctx.reply("Команда доступна только администраторам.");
      return;
    }

    await ctx.reply("Запускаю обновление курса...");
    const result = await runExchangeRateCheck();
    await ctx.reply(buildManualUpdateReply(result), {
      disable_notification: true,
    });
  } catch (error) {
    console.error("Manual update command failed:", error);
    await ctx.reply("Не удалось выполнить ручное обновление курса.");
  }
});

export const launchBot = () => {
  bot.telegram
    .setMyCommands([
      {
        command: "update_cur",
        description: "Ручное обновление курса для админов",
      },
    ])
    .catch((error) => {
      console.error("Failed to set bot commands:", error);
    });

  bot.launch();
};

export const handleUpdate = (body) => {
  bot.handleUpdate(body);
};
