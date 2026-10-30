export function localDateKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDayLabel(key, lang) {
  const d = new Date(`${key}T12:00:00`);
  return {
    weekday: new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { weekday: 'short' }).format(d),
    day: new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { day: '2-digit' }).format(d),
    month: new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { month: 'short' }).format(d)
  };
}
