export function localDateKey(value) {
  if (!value) return '';
  // If already a YYYY-MM-DD string, return it directly to avoid UTC-midnight timezone shifting
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function utcDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    return value.trim().slice(0, 10);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * Checks whether a match's utc_date matches a target calendar day (YYYY-MM-DD),
 * resilient to local, UTC, and CET/EET football timezone differences.
 */
export function isMatchOnDate(utcDate, targetDateStr) {
  if (!utcDate || !targetDateStr) return false;
  const target = targetDateStr.trim();

  // 1. Direct local date key match
  const lKey = localDateKey(utcDate);
  if (lKey === target) return true;

  // 2. Direct UTC date match (YYYY-MM-DD from ISO or timestamp)
  const uKey = utcDateKey(utcDate);
  if (uKey === target) return true;

  // 3. Fallback: match within generous ±14 hour window of target day noon UTC
  try {
    const targetNoon = new Date(`${target}T12:00:00Z`).getTime();
    const matchTime = new Date(utcDate).getTime();
    if (!Number.isNaN(targetNoon) && !Number.isNaN(matchTime)) {
      if (Math.abs(matchTime - targetNoon) <= 14 * 3600 * 1000) {
        return true;
      }
    }
  } catch {
    // ignore
  }

  return false;
}

export function formatDayLabel(key, lang) {
  const d = new Date(`${key}T12:00:00`);
  return {
    weekday: new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { weekday: 'short' }).format(d),
    day: new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { day: '2-digit' }).format(d),
    month: new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { month: 'short' }).format(d)
  };
}
