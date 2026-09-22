const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
  'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

function chunkToWords(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  return ones[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' ' + chunkToWords(n % 100) : '');
}

export function numberToWords(amount: number, currency: string): string {
  const currencyWords: Record<string, { main: string; sub: string }> = {
    PHP: { main: 'PESOS', sub: 'CENTAVOS' },
    AED: { main: 'DIRHAMS', sub: 'FILS' },
    USD: { main: 'DOLLARS', sub: 'CENTS' },
  };
  const cw = currencyWords[currency] || { main: currency, sub: 'CENTS' };

  const rounded = Math.round(amount * 100) / 100;
  const intPart = Math.floor(rounded);
  const decPart = Math.round((rounded - intPart) * 100);

  const parts: string[] = [];

  // C6 FIX: Handle billions (up to 999 billion)
  if (intPart >= 1_000_000_000) {
    parts.push(chunkToWords(Math.floor(intPart / 1_000_000_000)) + ' BILLION');
  }
  if (Math.floor((intPart % 1_000_000_000) / 1_000_000) > 0) {
    parts.push(chunkToWords(Math.floor((intPart % 1_000_000_000) / 1_000_000)) + ' MILLION');
  }
  if (Math.floor((intPart % 1_000_000) / 1000) > 0) {
    parts.push(chunkToWords(Math.floor((intPart % 1_000_000) / 1000)) + ' THOUSAND');
  }
  if (intPart % 1000 > 0) {
    parts.push(chunkToWords(intPart % 1000));
  }

  let result = (parts.join(' ') || 'ZERO') + ' ' + cw.main;
  if (decPart > 0) {
    result += ' AND ' + chunkToWords(decPart) + ' ' + cw.sub;
  }
  return result + ' ONLY';
}
