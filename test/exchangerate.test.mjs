import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchUsdRate,
  formatExchangeRate,
  parseCbrMirrorJson,
  parseOfficialCbrXml,
} from '../exchangerate/exchangerate.mjs';

const officialXml = Buffer.from(`<?xml version="1.0" encoding="windows-1251"?>
<ValCurs Date="21.08.2026" name="Foreign Currency Market">
  <Valute ID="R01010">
    <NumCode>036</NumCode>
    <CharCode>AUD</CharCode>
    <Nominal>1</Nominal>
    <Name>Australian Dollar</Name>
    <Value>59,2471</Value>
    <VunitRate>59,2471</VunitRate>
  </Valute>
  <Valute ID="R01235">
    <NumCode>840</NumCode>
    <CharCode>USD</CharCode>
    <Nominal>1</Nominal>
    <Name>US Dollar</Name>
    <Value>85,1234</Value>
    <VunitRate>85,1234</VunitRate>
  </Valute>
</ValCurs>`, 'latin1');

test('parses USD rate from the official CBR XML response', () => {
  assert.deepEqual(parseOfficialCbrXml(officialXml), {
    rawRate: 85.1234,
    sourceDate: '21.08.2026',
  });
});

test('uses Value divided by Nominal when VunitRate is absent', () => {
  const xml = Buffer.from(`
    <ValCurs Date="21.08.2026">
      <Valute><Nominal>10</Nominal><CharCode>USD</CharCode><Value>851,2340</Value></Valute>
    </ValCurs>
  `, 'latin1');

  assert.equal(parseOfficialCbrXml(xml).rawRate, 85.1234);
});

test('parses the legacy JSON mirror response', () => {
  const parsed = parseCbrMirrorJson({
    date: '2026-08-21',
    timestamp: 1787260800,
    rates: { USD: 1 / 85.1234 },
  });

  assert.equal(parsed.rawRate, 85.1234);
  assert.equal(parsed.sourceDate, '2026-08-21');
  assert.equal(parsed.sourceTimestamp, 1787260800);
});

test('rejects malformed or implausible provider data', () => {
  assert.throws(() => parseOfficialCbrXml(Buffer.from('<ValCurs />')));
  assert.throws(() => parseCbrMirrorJson({ rates: { USD: 0 } }));
});

test('uses the official CBR endpoint first', async () => {
  const calls = [];
  const httpClient = {
    async get(url) {
      calls.push(url);
      return {
        status: 200,
        data: officialXml,
        headers: {},
      };
    },
  };

  const result = await fetchUsdRate({ httpClient });

  assert.equal(result.source, 'official-cbr');
  assert.equal(result.rawRate, 85.1234);
  assert.equal(result.exchangeRates, '1\\$ \\= 85,12₽');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /cbr\.ru\/scripts\/XML_daily\.asp/);
});

test('falls back to the JSON mirror when the official CBR endpoint fails', async () => {
  const calls = [];
  const httpClient = {
    async get(url) {
      calls.push(url);

      if (url.includes('www.cbr.ru')) {
        throw new Error('official unavailable');
      }

      return {
        status: 200,
        data: {
          date: '2026-08-21',
          timestamp: 1787260800,
          rates: { USD: 1 / 85.5678 },
        },
        headers: {},
      };
    },
  };

  const result = await fetchUsdRate({ httpClient });

  assert.equal(result.source, 'cbr-xml-daily-mirror');
  assert.equal(result.rawRate, 85.5678);
  assert.equal(calls.length, 2);
});

test('returns a compact aggregate error when every provider fails', async () => {
  const httpClient = {
    async get() {
      const error = new Error('timeout');
      error.code = 'ETIMEDOUT';
      throw error;
    },
  };

  await assert.rejects(
    fetchUsdRate({ httpClient }),
    /All exchange rate providers failed.*official-cbr.*cbr-xml-daily-mirror/
  );
});

test('formats the Telegram MarkdownV2 rate consistently', () => {
  assert.equal(formatExchangeRate(85.1293), '1\\$ \\= 85,13₽');
});
