const PRICE_PATTERN =
  /(?:€\s*)?(\d(?:[\d\s.,]*\d)?)\s*(?:€)?\s*(?:(?:\/|al(?:la)?\s+|all['’]\s*)(kg|hg|etti?|etto|g))?/i;

const WEIGHT_PATTERN =
  /(\d+(?:[.,]\d+)?)\s*(kg|chilogrammi?|g|grammi?|hg|etti?|etto)\b/i;

function parseLocalizedNumber(value) {
  let normalized = String(value).replace(/\s+/g, '');
  const comma = normalized.lastIndexOf(',');
  const dot = normalized.lastIndexOf('.');

  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? /\./g : /,/g;
    normalized = normalized.replace(thousandsSeparator, '');
    normalized = normalized.replace(decimalSeparator, '.');
  } else {
    const separator = comma >= 0 ? ',' : dot >= 0 ? '.' : null;
    if (separator) {
      const separatorIndex = normalized.lastIndexOf(separator);
      const decimalDigits = normalized.length - separatorIndex - 1;
      if (decimalDigits === 3 && normalized.indexOf(separator) === separatorIndex) {
        normalized = normalized.replace(separator, '');
      } else {
        normalized = normalized.replace(separator, '.');
      }
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePriceUnit(unit) {
  if (!unit) return null;
  const normalized = unit.toLocaleLowerCase('it-IT');
  if (['hg', 'etto', 'etti'].includes(normalized)) return 'hg';
  return normalized;
}

export function parsePrice(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const match = String(input).normalize('NFKC').match(PRICE_PATTERN);
  if (!match) return null;

  const value = parseLocalizedNumber(match[1]);
  if (value === null) return null;

  return {
    value,
    per: normalizePriceUnit(match[2]),
  };
}

export function eurosToCents(value) {
  const numeric = typeof value === 'number' ? value : parseLocalizedNumber(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round((numeric + Number.EPSILON) * 100);
}

export function centsToEuros(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric / 100 : null;
}

export function parsePriceCents(input) {
  const parsed = parsePrice(input);
  if (!parsed) return null;
  return {
    value: eurosToCents(parsed.value),
    per: parsed.per,
  };
}

export function formatCents(value, locale = 'it-IT', currency = 'EUR') {
  const euros = centsToEuros(value);
  if (euros === null) return '';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(euros);
}

export function parseWeightGrams(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const match = String(input).normalize('NFKC').match(WEIGHT_PATTERN);
  if (!match) return null;

  const value = parseLocalizedNumber(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = match[2].toLocaleLowerCase('it-IT');
  const multiplier = unit.startsWith('kg') || unit.startsWith('chilo')
    ? 1000
    : ['hg', 'etto', 'etti'].includes(unit)
      ? 100
      : 1;

  return Math.round(value * multiplier);
}

export function normalizeName(input) {
  return String(input ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLocaleLowerCase('it-IT');
      return `${lower.charAt(0).toLocaleUpperCase('it-IT')}${lower.slice(1)}`;
    })
    .join(' ');
}

export function normalizeEan(input) {
  const digits = String(input ?? '').replace(/\s+/g, '');
  if (!/^(?:\d{8}|\d{13})$/.test(digits)) return null;

  let sum = 0;
  let weight = 3;
  for (let index = digits.length - 2; index >= 0; index -= 1) {
    sum += Number(digits[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }

  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number(digits.at(-1)) ? digits : null;
}
