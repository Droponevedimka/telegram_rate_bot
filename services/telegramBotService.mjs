import { Telegraf } from "telegraf";
import {
  TELEGRAM_TOKEN,
  TARGET_CHAT_ID,
  MESSAGE_DOLLAR_ID,
  MESSAGE_RUB_ID,
} from "../config.mjs";
import { getChatCompletion } from "./openaiService.mjs";
import promtOpenAI from "../promt/promt.mjs";
import getExchangeRates from "../exchangerate/exchangerate.mjs";

const bot = new Telegraf(TELEGRAM_TOKEN);

bot.on("text", async (ctx) => {
  const message = ctx.message.text;

  try {
    const exchangeRates = await getExchangeRates();
    promtOpenAI.push({
      role: "user",
      content: `текущий курс: ${exchangeRates}. сообщение от клиента: ${message} `,
    });

    const answerOpenAI = await getChatCompletion(promtOpenAI);

    promtOpenAI.push({
      role: "assistant",
      content: answerOpenAI,
    });

    if (answerOpenAI) {
      const username = ctx.from.username || "без_username";
      const lastName = ctx.from.last_name || "";
      const messageToSend = `${answerOpenAI} ${lastName} @${username} id${ctx.from.id}`;
      const messageThreadId =
        answerOpenAI.split(" ")[3].lastIndexOf("$") === -1
          ? MESSAGE_RUB_ID
          : MESSAGE_DOLLAR_ID;

      await bot.telegram.sendMessage(TARGET_CHAT_ID, messageToSend, {
        message_thread_id: messageThreadId,
      });
    }
  } catch (error) {
    console.error("Error processing message:", error);
    await ctx.reply("Произошла ошибка при проверке сообщения." + error.message);
  }
});

export const launchBot = () => {
  bot.launch();
};

export const handleUpdate = (body) => {
  bot.handleUpdate(body);
};
