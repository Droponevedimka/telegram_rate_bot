import axios from 'axios';

const BASE_URL = 'https://www.cbr-xml-daily.ru/latest.js';

async function getExchangeRates() {
  try {
    const response = await axios.get(BASE_URL);
    const rates = response.data;
    const res = 1 / rates.rates.USD;
    const countRates = res.toFixed(2);
    return {
      exchangeRates: '1\\$ \\= ' + countRates.replace('.', ',') + '\\₽',
      countRates,
    };
  } catch (error) {
    console.error('Error fetching exchange rates:', error);
  }
}

export default getExchangeRates;
