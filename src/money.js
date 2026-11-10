export const AMOUNT_CURRENCY = '€';

function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function parseAmount(text) {
  const cleaned = String(text ?? '').replace(/[^0-9,]/g, '');
  if (!cleaned) return 0;
  const commaIndex = cleaned.indexOf(',');
  const integerPart = commaIndex === -1 ? cleaned : cleaned.slice(0, commaIndex);
  const decimalPart = commaIndex === -1 ? '' : cleaned.slice(commaIndex + 1).replace(/,/g, '').slice(0, 2);
  const value = Number(`${integerPart || '0'}${decimalPart ? `.${decimalPart}` : ''}`);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

export function formatAmountInput(text) {
  const cleaned = String(text ?? '').replace(/[^0-9,]/g, '');
  if (!/\d/.test(cleaned)) return '';
  const commaIndex = cleaned.indexOf(',');
  const integerDigits = (commaIndex === -1 ? cleaned : cleaned.slice(0, commaIndex)).replace(/^0+/, '');
  const decimalDigits = commaIndex === -1 ? '' : cleaned.slice(commaIndex + 1).replace(/,/g, '').slice(0, 2);
  const hasComma = commaIndex !== -1;
  const onlyZeros = commaIndex === -1 ? /^0+$/.test(cleaned) : /^0*$/.test(cleaned.slice(0, commaIndex));
  const normalizedInteger = integerDigits || (hasComma || onlyZeros ? '0' : '');
  return `${groupThousands(normalizedInteger)}${hasComma ? `,${decimalDigits}` : ''}`;
}

export function formatCurrency(value) {
  const cents = Math.round((Number(value) || 0) * 100);
  const absoluteCents = Math.abs(cents);
  const integerPart = groupThousands(String(Math.floor(absoluteCents / 100)));
  const decimalPart = String(absoluteCents % 100).padStart(2, '0');
  const sign = cents < 0 ? '-' : '';
  return cents % 100 === 0 ? `${sign}${integerPart} ${AMOUNT_CURRENCY}` : `${sign}${integerPart},${decimalPart} ${AMOUNT_CURRENCY}`;
}
