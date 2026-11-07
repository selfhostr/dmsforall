/** `aaaa-mm-jj` local d'une date. */
export function jourLocal(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const j = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${j}`;
}

/** Bornes ISO (UTC) du jour local `aaaa-mm-jj` : minuit local inclus, minuit suivant exclu. */
export function bornesDuJour(jour: string): { readonly du: string; readonly au: string } {
  const [a, m, j] = jour.split('-').map(Number) as [number, number, number];
  const debut = new Date(a, m - 1, j, 0, 0, 0, 0);
  const fin = new Date(a, m - 1, j + 1, 0, 0, 0, 0);
  return { du: debut.toISOString(), au: fin.toISOString() };
}

/** Valeur `datetime-local` (`aaaa-mm-jjThh:mm`, heure locale) pour un jour et une heure. */
export function datetimeLocal(jour: string, heure: string): string {
  return `${jour}T${heure}`;
}
