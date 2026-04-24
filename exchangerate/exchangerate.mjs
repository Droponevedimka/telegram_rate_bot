import axios from 'axios';

const BASE_URL = 'https://www.cbr-xml-daily.ru/latest.js';
const DEFAULT_CHECK_DELAY_MS = 30 * 60 * 1000;
const MIN_CHECK_DELAY_MS = 60 * 1000;
const MAX_CHECK_DELAY_MS = 6 * 60 * 60 * 1000;

function clampDelay(delayMs) {
  if (!Number.isFinite(delayMs)) {
    return DEFAULT_CHECK_DELAY_MS;
  }

  return Math.min(Math.max(delayMs, MIN_CHECK_DELAY_MS), MAX_CHECK_DELAY_MS);
}

function getNextCheckDelayMs(headers = {}) {
  const cacheControl = headers['cache-control'];
  const maxAgeMatch = cacheControl?.match(/max-age=(\d+)/i);

  if (maxAgeMatch) {
    return clampDelay((Number(maxAgeMatch[1]) * 1000) + 5000);
  }

  if (headers.expires) {
    const expiresAt = Date.parse(headers.expires);

    if (Number.isFinite(expiresAt)) {
      return clampDelay((expiresAt - Date.now()) + 5000);
    }
  }

  return DEFAULT_CHECK_DELAY_MS;
}

export function formatExchangeRate(rawRate) {
  const countRates = rawRate.toFixed(2);
  return '1\\$ \\= ' + countRates.replace('.', ',') + '₽';
}

export async function fetchUsdRate({ ifModifiedSince } = {}) {
  const headers = {};

  if (ifModifiedSince) {
    headers['If-Modified-Since'] = ifModifiedSince;
  }

  const response = await axios.get(BASE_URL, {
    headers,
    timeout: 10000,
    validateStatus: (status) => status === 200 || status === 304,
  });

  const nextCheckDelayMs = getNextCheckDelayMs(response.headers);
  const lastModified = response.headers['last-modified'] || ifModifiedSince || null;

  if (response.status === 304) {
    return {
      status: 304,
      lastModified,
      nextCheckDelayMs,
    };
  }

  const rates = response.data;
  const rawRate = 1 / rates.rates.USD;
  const countRates = rawRate.toFixed(2);

  return {
    status: 200,
    rawRate,
    countRates,
    exchangeRates: formatExchangeRate(rawRate),
    lastModified,
    nextCheckDelayMs,
    sourceDate: rates.date || null,
    sourceTimestamp: rates.timestamp || null,
  };
}

async function getExchangeRates() {
  try {
    const response = await fetchUsdRate();

    if (response.status !== 200) {
      throw new Error('CBR returned a non-200 response without cached rate data.');
    }

    return {
      exchangeRates: response.exchangeRates,
      countRates: response.countRates,
      rawRate: response.rawRate,
    };
  } catch (error) {
    console.error('Error fetching exchange rates:', error);
    throw error;
  }
}

export default getExchangeRates;
