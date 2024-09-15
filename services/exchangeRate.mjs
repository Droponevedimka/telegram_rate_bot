import { Telegraf } from 'telegraf';
import { TELEGRAM_TOKEN, TARGET_CHAT_ID } from '../config.mjs';
import getExchangeRates from '../exchangerate/exchangerate.mjs';
import {
  savePinnedMessageState,
  loadPinnedMessageState,
  isMessageExpired,
} from '../functions/stateLocalFille.mjs';

const bot = new Telegraf(TELEGRAM_TOKEN);
const mainGroupId = 1;

// Function to delete a message by ID
async function deletePinnedMessage(messageId) {
  try {
    await bot.telegram.deleteMessage(TARGET_CHAT_ID, messageId);
    console.log('Old message deleted.');
  } catch (error) {
    console.error('Error deleting old message:', error);
  }
}

async function updatePinnedMessage() {
  const { exchangeRates, countRates } = await getExchangeRates();
  const pinnedMessageState = loadPinnedMessageState();
  const currentTime = new Date().getTime();

  if (pinnedMessageState.lastCountRates == countRates) {
    console.log('Курс не изменился обновлять нет смысла');
    return null;
  }

  if (
    pinnedMessageState?.timestamp &&
    isMessageExpired(pinnedMessageState.timestamp)
  ) {
    try {
      await deletePinnedMessage(pinnedMessageState.messageId);
      pinnedMessageState.messageId = null;
    } catch (error) {
      console.error('Удаление неудачно старого поста:', error);
    }
  }

  const exhcangeMessage = `Текущий курс ${exchangeRates} по цб [Яндекс конвертёр](https://ya.ru/search/?text=%D0%BA%D1%83%D1%80%D1%81+%D0%B4%D0%BE%D0%BB%D0%BB%D0%B0%D1%80%D0%B0+%D0%BA+%D1%80%D1%83%D0%B1%D0%BB%D1%8E)`;

  if (pinnedMessageState?.messageId) {
    try {
      await bot.telegram.editMessageText(
        TARGET_CHAT_ID,
        pinnedMessageState.messageId,
        null,
        exhcangeMessage,
        {
          parse_mode: 'MarkdownV2',
          disable_notification: true,
          link_preview_options: {
            is_disabled: true,
          },
        }
      );

      // Save the new message ID and timestamp
      savePinnedMessageState({
        messageId: pinnedMessageState.message_id,
        timestamp: pinnedMessageState.timestamp,
        lastCountRates: countRates,
      });
      console.log('Pinned message updated.');
    } catch (error) {
      console.error('Error updating the pinned message:', error);
    }
  } else {
    try {
      const message = await bot.telegram.sendMessage(
        TARGET_CHAT_ID,
        exhcangeMessage,
        {
          parse_mode: 'MarkdownV2',
          disable_notification: true,
          link_preview_options: {
            is_disabled: true,
          },
        }
      );

      await bot.telegram.pinChatMessage(TARGET_CHAT_ID, message.message_id, {
        disable_notification: true,
      });

      // Save the new message ID and timestamp
      savePinnedMessageState({
        messageId: message.message_id,
        timestamp: currentTime,
        lastCountRates: countRates,
      });
      console.log('New message sent and pinned.');
    } catch (error) {
      console.error('Error sending or pinning message:', error);
    }
  }
}

(async () => {
  await updatePinnedMessage();
  process.exit(0); // Ensure script exits after execution
})();
