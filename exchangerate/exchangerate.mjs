import axios from 'axios';

const OFFICIAL_CBR_URL = 'https://www.cbr.ru/scripts/XML_daily.asp';
const CBR_MIRROR_URL = 'https://www.cbr-xml-daily.ru/latest.js';
const REQUEST_TIMEOUT_MS = 10000;
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

function readXmlTag(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}>\\s*([^<]+?)\\s*</${tagName}>`, 'i'));
  return match?.[1]?.trim() || null;
}

function parseDecimal(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function validateRawRate(rawRate, source) {
  if (!Number.isFinite(rawRate) || rawRate <= 1 || rawRate >= 1000) {
    throw new Error(`${source} returned an invalid USD/RUB rate.`);
  }

  return rawRate;
}

function describeError(error) {
  const code = error?.code ? ` ${error.code}` : '';
  const status = error?.response?.status ? ` HTTP ${error.response.status}` : '';
  return `${error?.message || String(error)}${code}${status}`;
}

export function parseOfficialCbrXml(payload) {
  const xml = Buffer.isBuffer(payload)
    ? payload.toString('latin1')
    : Buffer.from(payload).toString('latin1');
  const usdBlock = xml
    .match(/<Valute\b[^>]*>[\s\S]*?<\/Valute>/gi)
    ?.find((block) => /<CharCode>\s*USD\s*<\/CharCode>/i.test(block));

  if (!usdBlock) {
    throw new Error('Official CBR response does not contain USD data.');
  }

  const unitRate = parseDecimal(readXmlTag(usdBlock, 'VunitRate'));
  const nominal = parseDecimal(readXmlTag(usdBlock, 'Nominal'));
  const value = parseDecimal(readXmlTag(usdBlock, 'Value'));
  const rawRate = unitRate ?? (
    Number.isFinite(value) && Number.isFinite(nominal) && nominal > 0
      ? value / nominal
      : null
  );
  const sourceDate = xml.match(/<ValCurs\b[^>]*\bDate="([^"]+)"/i)?.[1] || null;

  return {
    rawRate: validateRawRate(rawRate, 'Official CBR'),
    sourceDate,
  };
}

export function parseCbrMirrorJson(rates) {
  const rawRate = 1 / Number(rates?.rates?.USD);

  return {
    rawRate: validateRawRate(rawRate, 'CBR mirror'),
    sourceDate: rates?.date || null,
    sourceTimestamp: rates?.timestamp || null,
  };
}

async function fetchFromOfficialCbr(httpClient) {
  const response = await httpClient.get(OFFICIAL_CBR_URL, {
    timeout: REQUEST_TIMEOUT_MS,
    responseType: 'arraybuffer',
    validateStatus: (status) => status === 200,
  });
  const parsed = parseOfficialCbrXml(response.data);

  return {
    status: 200,
    ...parsed,
    lastModified: response.headers?.['last-modified'] || null,
    nextCheckDelayMs: DEFAULT_CHECK_DELAY_MS,
    source: 'official-cbr',
  };
}

async function fetchFromCbrMirror(httpClient, ifModifiedSince) {
  const headers = {};

  if (ifModifiedSince) {
    headers['If-Modified-Since'] = ifModifiedSince;
  }

  const response = await httpClient.get(CBR_MIRROR_URL, {
    headers,
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: (status) => status === 200 || status === 304,
  });
  const nextCheckDelayMs = getNextCheckDelayMs(response.headers);
  const lastModified = response.headers?.['last-modified'] || ifModifiedSince || null;

  if (response.status === 304) {
    return {
      status: 304,
      lastModified,
      nextCheckDelayMs,
      source: 'cbr-xml-daily-mirror',
    };
  }

  return {
    status: 200,
    ...parseCbrMirrorJson(response.data),
    lastModified,
    nextCheckDelayMs,
    source: 'cbr-xml-daily-mirror',
  };
}

export function formatExchangeRate(rawRate) {
  const countRates = rawRate.toFixed(2);
  return '1\\$ \\= ' + countRates.replace('.', ',') + '₽';
}

export async function fetchUsdRate({ ifModifiedSince, httpClient = axios } = {}) {
  const providers = [
    {
      name: 'official-cbr',
      fetch: () => fetchFromOfficialCbr(httpClient),
    },
    {
      name: 'cbr-xml-daily-mirror',
      fetch: () => fetchFromCbrMirror(httpClient, ifModifiedSince),
    },
  ];
  const failures = [];

  for (const provider of providers) {
    try {
      const result = await provider.fetch();

      if (failures.length > 0) {
        console.warn(`Exchange rate fallback succeeded via ${provider.name}.`);
      }

      if (result.status === 200) {
        const countRates = result.rawRate.toFixed(2);
        return {
          ...result,
          countRates,
          exchangeRates: formatExchangeRate(result.rawRate),
        };
      }

      return result;
    } catch (error) {
      const failure = `${provider.name}: ${describeError(error)}`;
      failures.push(failure);
      console.warn(`Exchange rate provider failed: ${failure}`);
    }
  }

  throw new Error(`All exchange rate providers failed (${failures.join('; ')}).`);
}

async function getExchangeRates() {
  const response = await fetchUsdRate();

  if (response.status !== 200) {
    throw new Error('CBR returned a non-200 response without cached rate data.');
  }

  return {
    exchangeRates: response.exchangeRates,
    countRates: response.countRates,
    rawRate: response.rawRate,
  };
}

export default getExchangeRates;
