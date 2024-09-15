import express from "express";
import bodyParser from "body-parser";
import { PORT, TELEGRAM_TOKEN } from "./config.mjs";
import { logger } from "./middlewares/logger.mjs";
import { launchBot, handleUpdate } from "./services/telegramBotService.mjs";

const app = express();

app.use(logger);
app.use(bodyParser.json());

app.post(`/webhook/${TELEGRAM_TOKEN}`, (req, res) => {
  handleUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  launchBot();
});
