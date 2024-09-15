import dotenv from "dotenv";

dotenv.config();

export const PORT = process.env.PORT || 3000;
export const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY_GENERAL;
export const TARGET_CHAT_ID = process.env.TARGET_CHAT_ID;
export const MESSAGE_DOLLAR_ID = process.env.DOLLAR_ID;
export const MESSAGE_RUB_ID = process.env.RUB_ID;
