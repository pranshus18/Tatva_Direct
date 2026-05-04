const INDIA_TIMEZONE = 'Asia/Kolkata';

const TZ_SUFFIX_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i;
const SQL_LIKE_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;
const ISO_NO_TZ_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;

export const parseServerDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;

  let normalized = raw;
  if (SQL_LIKE_DATETIME_PATTERN.test(normalized)) {
    normalized = normalized.replace(' ', 'T');
  }
  if (ISO_NO_TZ_PATTERN.test(normalized) && !TZ_SUFFIX_PATTERN.test(normalized)) {
    normalized = `${normalized}Z`;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatDateTimeIST = (value, fallback = 'N/A') => {
  const date = parseServerDate(value);
  if (!date) return fallback;
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.day}/${map.month}/${map.year}, ${map.hour}:${map.minute}:${map.second}`;
};

export const formatDateIST = (value, fallback = 'N/A') => {
  const date = parseServerDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
};

export default {
  parseServerDate,
  formatDateTimeIST,
  formatDateIST
};
