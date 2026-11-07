/** Délai de paiement par défaut : entier de 0 à 365 jours. `null` = saisie refusée. */
export function validerDelaiPaiement(saisie: string): number | null {
  const texte = saisie.trim();
  if (!/^\d{1,3}$/.test(texte)) return null;
  const jours = Number(texte);
  return jours >= 0 && jours <= 365 ? jours : null;
}
