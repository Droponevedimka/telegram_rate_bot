import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_PINNED_MESSAGE_FILE = path.resolve(process.cwd(), 'statePinnedID.txt');
const FALLBACK_PINNED_MESSAGE_FILE = path.join(
  os.homedir(),
  '.local',
  'state',
  'telegram_rate_bot',
  'statePinnedID.txt'
);
const PINNED_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

let loggedFallbackPath = false;

function parseRawRate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsedValue = Number(value);

    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return null;
}

function normalizePinnedMessageState(state) {
  if (!state || typeof state !== 'object') {
    return null;
  }

  return {
    messageId: state.messageId ?? state.message_id ?? null,
    lastPublishedAt: state.lastPublishedAt ?? state.timestamp ?? null,
    lastRawRate: parseRawRate(state.lastRawRate ?? state.lastCountRates ?? state.countRates),
    lastModified: state.lastModified ?? null,
    lastCheckedAt: state.lastCheckedAt ?? null,
    nextCheckAt: state.nextCheckAt ?? null,
  };
}

function getConfiguredStateFilePath() {
  if (!process.env.PINNED_MESSAGE_FILE) {
    return DEFAULT_PINNED_MESSAGE_FILE;
  }

  return path.resolve(process.env.PINNED_MESSAGE_FILE);
}

function canWriteToPath(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.accessSync(filePath, fs.constants.W_OK);
      return true;
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.accessSync(path.dirname(filePath), fs.constants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function getWritableStateFilePath() {
  const configuredPath = getConfiguredStateFilePath();

  if (canWriteToPath(configuredPath)) {
    return configuredPath;
  }

  fs.mkdirSync(path.dirname(FALLBACK_PINNED_MESSAGE_FILE), { recursive: true });

  if (!loggedFallbackPath && configuredPath !== FALLBACK_PINNED_MESSAGE_FILE) {
    console.warn(
      `Pinned state file is not writable at ${configuredPath}. Falling back to ${FALLBACK_PINNED_MESSAGE_FILE}.`
    );
    loggedFallbackPath = true;
  }

  return FALLBACK_PINNED_MESSAGE_FILE;
}

function getReadableStateFilePaths() {
  const writablePath = getWritableStateFilePath();
  const configuredPath = getConfiguredStateFilePath();

  return [...new Set([writablePath, configuredPath, FALLBACK_PINNED_MESSAGE_FILE])];
}

export function savePinnedMessageState(state) {
  const normalizedState = normalizePinnedMessageState(state) || {
    messageId: null,
    lastPublishedAt: null,
    lastRawRate: null,
    lastModified: null,
    lastCheckedAt: null,
    nextCheckAt: null,
  };

  const stateFilePath = getWritableStateFilePath();

  fs.writeFileSync(stateFilePath, JSON.stringify(normalizedState), 'utf8');
}

export function loadPinnedMessageState() {
  for (const stateFilePath of getReadableStateFilePaths()) {
    if (!fs.existsSync(stateFilePath)) {
      continue;
    }

    try {
      const data = fs.readFileSync(stateFilePath, 'utf8');
      return normalizePinnedMessageState(JSON.parse(data));
    } catch (error) {
      console.error('Failed to load pinned message state:', error);
    }
  }

  return null;
}

export function isMessageExpired(timestamp) {
  if (!timestamp) {
    return true;
  }

  const currentTime = new Date().getTime();
  const timeElapsed = currentTime - timestamp;
  return timeElapsed >= PINNED_MESSAGE_TTL_MS;
}
