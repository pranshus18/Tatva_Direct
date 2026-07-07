const INDIA_TIMEZONE = 'Asia/Kolkata';

const TZ_SUFFIX_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i;
const SQL_LIKE_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;
const ISO_NO_TZ_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const parseServerDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;

  if (DATE_ONLY_PATTERN.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    const parsed = new Date(year, month - 1, day, 12, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

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

function formatPartsInIST(date, includeTime = false) {
  const options = {
    timeZone: INDIA_TIMEZONE,
    day: '2-digit',
    month: 'long',
    year: '2-digit'
  };
  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
    options.second = '2-digit';
    options.hour12 = false;
  }

  const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dateStr = `${map.day}/${map.month}/${map.year}`;
  if (includeTime) {
    return `${dateStr}, ${map.hour}:${map.minute}:${map.second}`;
  }
  return dateStr;
}

/** Platform standard: DD/Monthname/YY (e.g. 18/June/26) */
export const formatPlatformDate = (value, fallback = 'N/A') => {
  const date = parseServerDate(value);
  if (!date) return fallback;
  return formatPartsInIST(date, false);
};

/** Platform standard date + 24h time in IST (e.g. 18/June/26, 14:30:00) */
export const formatPlatformDateTime = (value, fallback = 'N/A') => {
  const date = parseServerDate(value);
  if (!date) return fallback;
  return formatPartsInIST(date, true);
};

export const formatDateIST = formatPlatformDate;
export const formatDateTimeIST = formatPlatformDateTime;

/** YYYY-MM-DD for `<input type="date">` min values in IST */
export function getTodayDateInputValue(timeZone = INDIA_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

export function isDateBeforeToday(value, timeZone = INDIA_TIMEZONE) {
  const raw = String(value || '').trim().slice(0, 10);
  if (!DATE_ONLY_PATTERN.test(raw)) return false;
  return raw < getTodayDateInputValue(timeZone);
}

export default {
  parseServerDate,
  formatPlatformDate,
  formatPlatformDateTime,
  formatDateTimeIST,
  formatDateIST,
  getTodayDateInputValue,
  isDateBeforeToday
};
