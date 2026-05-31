import { config } from './config.js';

export function mexicoDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.mexicoTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return formatter.format(date);
}

export function mexicoNowLabel(date = new Date()) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: config.mexicoTimeZone,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

export function msUntilNextMexicoDate(date = new Date()) {
  const currentKey = mexicoDateKey(date);
  let low = 1;
  let high = 27 * 60 * 60 * 1000;

  while (mexicoDateKey(new Date(date.getTime() + low)) === currentKey && low < high) {
    low *= 2;
  }

  high = Math.min(low, high);
  low = Math.floor(low / 2);

  while (high - low > 1000) {
    const mid = Math.floor((low + high) / 2);
    if (mexicoDateKey(new Date(date.getTime() + mid)) === currentKey) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return high;
}
