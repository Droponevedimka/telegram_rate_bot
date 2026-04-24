import path from 'path';
import { fileURLToPath } from 'url';
import { TARGET_CHAT_ID } from '../config.mjs';
import {
  fetchUsdRate,
  formatExchangeRate,
} from '../exchangerate/exchangerate.mjs';
import {
  savePinnedMessageState,
  loadPinnedMessageState,
  isMessageExpired,
} from '../functions/stateLocalFille.mjs';
import { createTelegramBot } from './telegramClient.mjs';

const bot = createTelegramBot();
const DEFAULT_CHECK_DELAY_MS = 30 * 60 * 1000;
const directModulePath = fileURLToPath(import.meta.url);

let schedulerTimeout = null;
let checkInProgress = false;

function getEmptyState() {
  return {
    messageId: null,
    lastPublishedAt: null,
    lastRawRate: null,
    lastModified: null,
    lastCheckedAt: null,
    nextCheckAt: null,
  };
}

function buildExchangeMessage(rawRate) {
  return `Текущий курс ${formatExchangeRate(rawRate)} по цб [Яндекс конвертёр](https://ya.ru/search/?text=%D0%BA%D1%83%D1%80%D1%81+%D0%B4%D0%BE%D0%BB%D0%BB%D0%B0%D1%80%D0%B0+%D0%BA+%D1%80%D1%83%D0%B1%D0%BB%D1%8E+%D0%BA%D0%BE%D0%BD%D0%B2%D0%B5%D1%80%D1%82%D0%B5%D1%80&lr=213&src=suggest_B)`;
}

function isMissingMessageError(error) {
  return (
    error?.response?.error_code === 400 &&
    typeof error?.response?.description === 'string' &&
    error.response.description.includes('message to edit not found')
  );
}

async function getPinnedMessageCandidates(savedMessageId) {
  const messageIds = new Set();

  if (savedMessageId) {
    messageIds.add(savedMessageId);
  }

  try {
    const chat = await bot.telegram.getChat(TARGET_CHAT_ID);
    const pinnedMessageId = chat?.pinned_message?.message_id;

    if (pinnedMessageId) {
      messageIds.add(pinnedMessageId);
    }
  } catch (error) {
    console.error('Error loading chat metadata before rate update:', error);
  }

  return [...messageIds];
}

async function cleanupPreviousRateMessages(savedMessageId) {
  const deletedMessageIds = [];
  const messageIds = await getPinnedMessageCandidates(savedMessageId);

  for (const messageId of messageIds) {
    try {
      await bot.telegram.deleteMessage(TARGET_CHAT_ID, messageId);
      deletedMessageIds.push(messageId);
      console.log(`Deleted previous rate message ${messageId}.`);
    } catch (error) {
      console.error(`Error deleting previous rate message ${messageId}:`, error);
    }
  }

  return deletedMessageIds;
}

async function deletePinServiceMessage(serviceMessageId) {
  if (!serviceMessageId) {
    return false;
  }

  try {
    await bot.telegram.deleteMessage(TARGET_CHAT_ID, serviceMessageId);
    console.log(`Deleted pin service message ${serviceMessageId}.`);
    return true;
  } catch (error) {
    console.error(`Error deleting pin service message ${serviceMessageId}:`, error);
    return false;
  }
}

function scheduleNextCheck(delayMs) {
  const nextDelayMs = Math.max(delayMs || DEFAULT_CHECK_DELAY_MS, 60 * 1000);

  if (schedulerTimeout) {
    clearTimeout(schedulerTimeout);
  }

  schedulerTimeout = setTimeout(() => {
    void runExchangeRateCheck({ isScheduledRun: true });
  }, nextDelayMs);

  console.log(
    `Next exchange rate check scheduled in ${Math.round(nextDelayMs / 60000)} minute(s).`
  );
}

async function deletePinnedMessage(messageId) {
  if (!messageId) {
    return;
  }

  try {
    await bot.telegram.deleteMessage(TARGET_CHAT_ID, messageId);
    console.log('Old message deleted.');
  } catch (error) {
    console.error('Error deleting old message:', error);
  }
}

async function publishPinnedMessage(rawRate) {
  const exchangeMessage = buildExchangeMessage(rawRate);
  const message = await bot.telegram.sendMessage(TARGET_CHAT_ID, exchangeMessage, {
    parse_mode: 'MarkdownV2',
    disable_notification: true,
    link_preview_options: {
      is_disabled: true,
    },
  });

  await bot.telegram.pinChatMessage(TARGET_CHAT_ID, message.message_id, {
    disable_notification: true,
  });

  await deletePinServiceMessage(message.message_id + 1);

  return message.message_id;
}

async function editPinnedMessage(messageId, rawRate) {
  const exchangeMessage = buildExchangeMessage(rawRate);

  await bot.telegram.editMessageText(
    TARGET_CHAT_ID,
    messageId,
    null,
    exchangeMessage,
    {
      parse_mode: 'MarkdownV2',
      disable_notification: true,
      link_preview_options: {
        is_disabled: true,
      },
    }
  );
}

export async function runExchangeRateCheck({ isScheduledRun = false } = {}) {
  if (checkInProgress) {
    console.log('Exchange rate check skipped because a previous run is still active.');
    return {
      nextCheckDelayMs: DEFAULT_CHECK_DELAY_MS,
    };
  }

  checkInProgress = true;

  const currentTime = Date.now();
  const pinnedMessageState = loadPinnedMessageState() || getEmptyState();
  let nextCheckDelayMs = DEFAULT_CHECK_DELAY_MS;

  const result = {
    action: 'noop',
    sourceDate: null,
    sourceTimestamp: null,
    lastModified: pinnedMessageState.lastModified || null,
    previousRate:
      typeof pinnedMessageState.lastRawRate === 'number' ? pinnedMessageState.lastRawRate : null,
    currentRate:
      typeof pinnedMessageState.lastRawRate === 'number' ? pinnedMessageState.lastRawRate : null,
    deletedMessageIds: [],
    messageId: pinnedMessageState.messageId || null,
    nextCheckDelayMs,
  };

  try {
    const rateResponse = await fetchUsdRate({
      ifModifiedSince: pinnedMessageState.lastModified || undefined,
    });

    nextCheckDelayMs = rateResponse.nextCheckDelayMs || DEFAULT_CHECK_DELAY_MS;
    result.nextCheckDelayMs = nextCheckDelayMs;
    result.sourceDate = rateResponse.sourceDate || null;
    result.sourceTimestamp = rateResponse.sourceTimestamp || null;
    result.lastModified = rateResponse.lastModified || pinnedMessageState.lastModified || null;

    const nextState = {
      ...pinnedMessageState,
      lastModified: rateResponse.lastModified || pinnedMessageState.lastModified,
      lastCheckedAt: currentTime,
      nextCheckAt: currentTime + nextCheckDelayMs,
    };

    const shouldRotatePinnedMessage =
      !pinnedMessageState.messageId || isMessageExpired(pinnedMessageState.lastPublishedAt);

    if (rateResponse.status === 304) {
      result.action = shouldRotatePinnedMessage ? 'rotated' : 'not_modified';

      if (shouldRotatePinnedMessage) {
        if (typeof pinnedMessageState.lastRawRate !== 'number') {
          throw new Error('Cannot rotate pinned message without a cached exchange rate.');
        }

        result.deletedMessageIds = await cleanupPreviousRateMessages(
          pinnedMessageState.messageId
        );
        const newMessageId = await publishPinnedMessage(pinnedMessageState.lastRawRate);
        result.messageId = newMessageId;
        result.currentRate = pinnedMessageState.lastRawRate;

        savePinnedMessageState({
          ...nextState,
          messageId: newMessageId,
          lastPublishedAt: currentTime,
          lastRawRate: pinnedMessageState.lastRawRate,
        });
        console.log('Pinned message rotated without a CBR content change.');
      } else {
        savePinnedMessageState(nextState);
        result.currentRate = pinnedMessageState.lastRawRate;
        console.log('CBR data not modified; pinned message left unchanged.');
      }

      return result;
    }

    const rateChanged =
      typeof pinnedMessageState.lastRawRate !== 'number' ||
      Math.abs(rateResponse.rawRate - pinnedMessageState.lastRawRate) > Number.EPSILON;

    result.currentRate = rateResponse.rawRate;

    if (shouldRotatePinnedMessage) {
      result.action = 'rotated';
      result.deletedMessageIds = await cleanupPreviousRateMessages(
        pinnedMessageState.messageId
      );
      const newMessageId = await publishPinnedMessage(rateResponse.rawRate);
      result.messageId = newMessageId;

      savePinnedMessageState({
        ...nextState,
        messageId: newMessageId,
        lastPublishedAt: currentTime,
        lastRawRate: rateResponse.rawRate,
      });
      console.log('Pinned message published and pinned.');
    } else if (rateChanged) {
      result.action = 'updated';
      try {
        result.deletedMessageIds = await cleanupPreviousRateMessages(
          pinnedMessageState.messageId
        );
        const newMessageId = await publishPinnedMessage(rateResponse.rawRate);

        savePinnedMessageState({
          ...nextState,
          messageId: newMessageId,
          lastPublishedAt: currentTime,
          lastRawRate: rateResponse.rawRate,
        });
        result.messageId = newMessageId;
        console.log('Pinned message replaced after a CBR change.');
      } catch (error) {
        if (!isMissingMessageError(error)) {
          throw error;
        }

        result.deletedMessageIds = await cleanupPreviousRateMessages(
          pinnedMessageState.messageId
        );
        const newMessageId = await publishPinnedMessage(rateResponse.rawRate);

        savePinnedMessageState({
          ...nextState,
          messageId: newMessageId,
          lastPublishedAt: currentTime,
          lastRawRate: rateResponse.rawRate,
        });
        result.messageId = newMessageId;
        console.log('Pinned message was missing, so a new one was published and pinned.');
      }
    } else {
      result.action = 'unchanged';
      savePinnedMessageState({
        ...nextState,
        lastRawRate: rateResponse.rawRate,
      });
      console.log('CBR returned 200, but the USD/RUB value did not change.');
    }

    return result;
  } catch (error) {
    console.error('Exchange rate check failed:', error);

    result.action = 'failed';
    result.errorMessage = error.message;

    return result;
  } finally {
    checkInProgress = false;

    if (isScheduledRun) {
      scheduleNextCheck(nextCheckDelayMs);
    }
  }
}

export function startExchangeRateScheduler() {
  console.log('Starting exchange rate scheduler.');
  void runExchangeRateCheck({ isScheduledRun: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === directModulePath) {
  runExchangeRateCheck()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('Exchange rate runner failed:', error);
      process.exit(1);
    });
}
