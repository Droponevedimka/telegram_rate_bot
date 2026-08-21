import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TELEGRAM_TOKEN = '123456:test-token';
process.env.TARGET_CHAT_ID = '-1001234567890';

const { reconcilePinnedMessage } = await import('../services/exchangeRate.mjs');

function telegramError(description) {
  const error = new Error(description);
  error.response = {
    error_code: 400,
    description,
  };
  return error;
}

test('leaves an unchanged message alone when it is already pinned', async () => {
  const calls = [];
  const telegram = {
    async getChat() {
      calls.push('getChat');
      return { pinned_message: { message_id: 9435 } };
    },
    async editMessageText() {
      calls.push('editMessageText');
    },
    async pinChatMessage() {
      calls.push('pinChatMessage');
    },
  };

  const result = await reconcilePinnedMessage({
    savedMessageId: 9435,
    rawRate: 85.12,
    rateChanged: false,
    telegram,
    chatId: -1001234567890,
  });

  assert.equal(result.action, 'unchanged');
  assert.deepEqual(calls, ['getChat']);
});

test('restores a missing pin without creating a duplicate message', async () => {
  const calls = [];
  const telegram = {
    async getChat() {
      calls.push('getChat');
      return {};
    },
    async editMessageText() {
      calls.push('editMessageText');
      throw telegramError('Bad Request: message is not modified');
    },
    async pinChatMessage(_chatId, messageId) {
      calls.push(`pinChatMessage:${messageId}`);
    },
    async sendMessage() {
      calls.push('sendMessage');
      return { message_id: 9999 };
    },
  };

  const result = await reconcilePinnedMessage({
    savedMessageId: 9435,
    rawRate: 85.12,
    rateChanged: false,
    telegram,
    chatId: -1001234567890,
  });

  assert.equal(result.action, 'repinned');
  assert.equal(result.messageId, 9435);
  assert.deepEqual(calls, ['getChat', 'editMessageText', 'pinChatMessage:9435']);
});

test('recreates and pins the rate message when the saved message was deleted', async () => {
  const calls = [];
  const telegram = {
    async getChat() {
      calls.push('getChat');
      return {};
    },
    async editMessageText() {
      calls.push('editMessageText');
      throw telegramError('Bad Request: message to edit not found');
    },
    async pinChatMessage(_chatId, messageId) {
      calls.push(`pinChatMessage:${messageId}`);
    },
    async sendMessage() {
      calls.push('sendMessage');
      return { message_id: 9999 };
    },
  };

  const result = await reconcilePinnedMessage({
    savedMessageId: 9435,
    rawRate: 85.12,
    rateChanged: false,
    telegram,
    chatId: -1001234567890,
  });

  assert.equal(result.action, 'recreated');
  assert.equal(result.messageId, 9999);
  assert.deepEqual(calls, [
    'getChat',
    'editMessageText',
    'sendMessage',
    'pinChatMessage:9999',
  ]);
});

test('edits the saved bot message and never deletes the current chat pin', async () => {
  const calls = [];
  const telegram = {
    async getChat() {
      calls.push('getChat');
      return { pinned_message: { message_id: 7777 } };
    },
    async editMessageText(_chatId, messageId) {
      calls.push(`editMessageText:${messageId}`);
    },
    async pinChatMessage(_chatId, messageId) {
      calls.push(`pinChatMessage:${messageId}`);
    },
  };

  const result = await reconcilePinnedMessage({
    savedMessageId: 9435,
    rawRate: 86.34,
    rateChanged: true,
    telegram,
    chatId: -1001234567890,
  });

  assert.equal(result.action, 'updated');
  assert.deepEqual(calls, [
    'getChat',
    'editMessageText:9435',
    'pinChatMessage:9435',
  ]);
});
