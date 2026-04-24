import https from "node:https";
import { Telegraf } from "telegraf";
import {
  TELEGRAM_API_ROOT,
  TELEGRAM_REQUEST_TIMEOUT_MS,
  TELEGRAM_TOKEN,
} from "../config.mjs";

const telegramAgent = new https.Agent({
  keepAlive: true,
  family: 4,
  timeout: TELEGRAM_REQUEST_TIMEOUT_MS,
});

export function createTelegramBot() {
  return new Telegraf(TELEGRAM_TOKEN, {
    handlerTimeout: TELEGRAM_REQUEST_TIMEOUT_MS,
    telegram: {
      apiRoot: TELEGRAM_API_ROOT,
      agent: telegramAgent,
      attachmentAgent: telegramAgent,
    },
  });
}