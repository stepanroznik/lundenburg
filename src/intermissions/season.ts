export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export function seasonAt(date: Date, timezone = 'Europe/Prague'): Season {
  const month = Number(new Intl.DateTimeFormat('en', { timeZone: timezone, month: 'numeric' }).format(date));
  return month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter';
}
