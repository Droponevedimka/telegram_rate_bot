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

function getTelegramErrorDescription(error) {
  return error?.response?.description || error?.message || String(error);
}

function isMissingMessageError(error) {
  const description = getTelegramErrorDescription(error).toLowerCase();
  return (
    error?.response?.error_code === 400 &&
    (
      description.includes('message to edit not found') ||
      description.includes('message to pin not found') ||
      description.includes('message not found') ||
      description.includes('message_id_invalid')
    )
  );
}

function isMessageNotModifiedError(error) {
  return (
    error?.response?.error_code === 400 &&
    getTelegramErrorDescription(error).toLowerCase().includes('message is not modified')
  );
}

function logCompactError(prefix, error) {
  console.error(`${prefix}: ${getTelegramErrorDescription(error)}`);
}

async function getPinnedMessageStatus(telegram = bot.telegram, chatId = TARGET_CHAT_ID) {
  try {
    const chat = await telegram.getChat(chatId);
    return {
      known: true,
      messageId: chat?.pinned_message?.message_id || null,
    };
  } catch (error) {
    logCompactError('Error loading chat metadata', error);
    return {
      known: false,
      messageId: null,
    };
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

async function publishPinnedMessage(
  rawRate,
  telegram = bot.telegram,
  chatId = TARGET_CHAT_ID
) {
  const exchangeMessage = buildExchangeMessage(rawRate);
  const message = await telegram.sendMessage(chatId, exchangeMessage, {
    parse_mode: 'MarkdownV2',
    disable_notification: true,
    link_preview_options: {
      is_disabled: true,
    },
  });

  await telegram.pinChatMessage(chatId, message.message_id, {
    disable_notification: true,
  });

  return message.message_id;
}

async function editOwnMessage(
  messageId,
  rawRate,
  telegram = bot.telegram,
  chatId = TARGET_CHAT_ID
) {
  const exchangeMessage = buildExchangeMessage(rawRate);

  try {
    await telegram.editMessageText(
      chatId,
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
  } catch (error) {
    if (!isMessageNotModifiedError(error)) {
      throw error;
    }
  }
}

export async function reconcilePinnedMessage({
  savedMessageId,
  rawRate,
  rateChanged,
  telegram = bot.telegram,
  chatId = TARGET_CHAT_ID,
}) {
  const pinnedStatus = await getPinnedMessageStatus(telegram, chatId);
  const pinIsCurrent = (
    pinnedStatus.known &&
    savedMessageId &&
    pinnedStatus.messageId === savedMessageId
  );

  if (savedMessageId) {
    try {
      if (rateChanged || !pinIsCurrent) {
        await editOwnMessage(savedMessageId, rawRate, telegram, chatId);
      }

      if (!pinIsCurrent) {
        await telegram.pinChatMessage(chatId, savedMessageId, {
          disable_notification: true,
        });
        return {
          action: rateChanged ? 'updated' : 'repinned',
          messageId: savedMessageId,
          publishedAt: Date.now(),
        };
      }

      return {
        action: rateChanged ? 'updated' : 'unchanged',
        messageId: savedMessageId,
        publishedAt: rateChanged ? Date.now() : null,
      };
    } catch (error) {
      if (!isMissingMessageError(error)) {
        throw error;
      }

      console.warn(`Saved rate message ${savedMessageId} no longer exists; publishing a new one.`);
    }
  }

  const messageId = await publishPinnedMessage(rawRate, telegram, chatId);
  return {
    action: savedMessageId ? 'recreated' : 'published',
    messageId,
    publishedAt: Date.now(),
  };
}

async function recoverPinnedMessageFromCache(pinnedMessageState) {
  if (typeof pinnedMessageState.lastRawRate !== 'number') {
    return null;
  }

  const pinnedStatus = await getPinnedMessageStatus();

  if (
    pinnedStatus.known &&
    pinnedMessageState.messageId &&
    pinnedStatus.messageId === pinnedMessageState.messageId
  ) {
    return null;
  }

  return reconcilePinnedMessage({
    savedMessageId: pinnedMessageState.messageId,
    rawRate: pinnedMessageState.lastRawRate,
    rateChanged: false,
  });
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
    source: null,
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
    result.source = rateResponse.source || null;
    result.sourceDate = rateResponse.sourceDate || null;
    result.sourceTimestamp = rateResponse.sourceTimestamp || null;
    result.lastModified = rateResponse.lastModified || pinnedMessageState.lastModified || null;

    const rawRate = rateResponse.status === 304
      ? pinnedMessageState.lastRawRate
      : rateResponse.rawRate;

    if (typeof rawRate !== 'number' || !Number.isFinite(rawRate)) {
      throw new Error('Cannot update the pinned message without a valid exchange rate.');
    }

    const rateChanged = (
      typeof pinnedMessageState.lastRawRate !== 'number' ||
      Math.abs(rawRate - pinnedMessageState.lastRawRate) > Number.EPSILON
    );
    const pinResult = await reconcilePinnedMessage({
      savedMessageId: pinnedMessageState.messageId,
      rawRate,
      rateChanged,
    });

    result.currentRate = rawRate;
    result.messageId = pinResult.messageId;
    result.action = (
      rateResponse.status === 304 && pinResult.action === 'unchanged'
        ? 'not_modified'
        : pinResult.action
    );

    savePinnedMessageState({
      ...pinnedMessageState,
      messageId: pinResult.messageId,
      lastPublishedAt: pinResult.publishedAt || pinnedMessageState.lastPublishedAt,
      lastRawRate: rawRate,
      lastModified: rateResponse.lastModified || pinnedMessageState.lastModified,
      lastCheckedAt: currentTime,
      nextCheckAt: currentTime + nextCheckDelayMs,
    });

    console.log(
      `Exchange rate check succeeded via ${result.source || 'unknown source'}; action=${result.action}.`
    );
    return result;
  } catch (error) {
    const errorMessage = error?.message || String(error);
    console.error(`Exchange rate check failed: ${errorMessage}`);
    result.action = 'failed';
    result.errorMessage = errorMessage;

    try {
      const recovery = await recoverPinnedMessageFromCache(pinnedMessageState);

      if (recovery) {
        result.action = 'recovered_cached';
        result.messageId = recovery.messageId;
        savePinnedMessageState({
          ...pinnedMessageState,
          messageId: recovery.messageId,
          lastPublishedAt: recovery.publishedAt || pinnedMessageState.lastPublishedAt,
          nextCheckAt: currentTime + nextCheckDelayMs,
        });
        console.warn('Restored the pinned message from the last cached exchange rate.');
      }
    } catch (recoveryError) {
      logCompactError('Cached pin recovery failed', recoveryError);
    }

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
