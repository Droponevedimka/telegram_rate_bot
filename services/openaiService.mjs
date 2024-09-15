import OpenAI from "openai";
import { OPENAI_API_KEY } from "../config.mjs";

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

export const getChatCompletion = async (promtOpenAI) => {
  const stream = await openai.chat.completions.create({
    model: "gpt-4-turbo",
    messages: promtOpenAI,
    stream: true,
  });

  let correctedMessage = "";
  for await (const chunk of stream) {
    correctedMessage += chunk.choices[0]?.delta?.content || "";
  }

  return correctedMessage.trim();
};
