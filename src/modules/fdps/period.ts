export type Period = 'mes' | 'any' | 'sempre';

/** Today in Europe/Madrid (the server uses the same day boundary). */
export const madridToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
export function periodFrom(p: Period, today = madridToday()): string | null {
  if (p === 'mes') return today.slice(0, 7) + '-01';
  if (p === 'any') return today.slice(0, 4) + '-01-01';
  return null;
}

