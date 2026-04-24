import dns from "node:dns";
import dotenv from "dotenv";

dotenv.config();

try {
	dns.setDefaultResultOrder("ipv4first");
} catch (error) {
	console.warn("Failed to prefer IPv4 DNS resolution:", error.message);
}

export const PORT = process.env.PORT || 3000;
export const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
export const TELEGRAM_API_ROOT =
	process.env.TELEGRAM_API_ROOT || "https://api.telegram.org";
export const TELEGRAM_REQUEST_TIMEOUT_MS = Number(
	process.env.TELEGRAM_REQUEST_TIMEOUT_MS || 15000,
);
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY_GENERAL;
export const TARGET_CHAT_ID = process.env.TARGET_CHAT_ID;
export const MESSAGE_DOLLAR_ID = process.env.DOLLAR_ID;
export const MESSAGE_RUB_ID = process.env.RUB_ID;
export const BOT_ADMIN_IDS = (process.env.BOT_ADMIN_IDS || "")
	.split(",")
	.map((value) => value.trim())
	.filter(Boolean)
	.map((value) => Number(value))
	.filter((value) => Number.isFinite(value));
