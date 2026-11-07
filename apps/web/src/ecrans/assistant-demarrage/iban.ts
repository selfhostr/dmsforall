export type CompteQr = { readonly iban: string } | { readonly qrIban: string };

/** Majuscules, sans espaces : la forme que le serveur normalise de toute façon. */
export function compacterIban(saisie: string): string {
  return saisie.replace(/\s+/g, '').toUpperCase();
}

/**
 * Un seul champ « IBAN » pour le garagiste : on le range dans le bon compte. Un QR-IBAN a un
 * identifiant d'établissement (positions 5 à 9) compris entre 30000 et 31999 ; tout autre IBAN
 * est un compte ordinaire. Le serveur revalide la clé de contrôle et refuse un compte mal rangé.
 */
export function classerCompte(saisie: string): CompteQr | null {
  const compact = compacterIban(saisie);
  if (compact === '') return null;
  const iid = /^(?:CH|LI)\d{2}(\d{5})/.exec(compact)?.[1];
  if (iid !== undefined) {
    const n = Number(iid);
    if (n >= 30000 && n <= 31999) return { qrIban: compact };
  }
  return { iban: compact };
}

/** Affichage par blocs de quatre (CH93 0076 2011 6238 5295 7). */
export function grouperIban(compact: string): string {
  return compact.replace(/(.{4})/g, '$1 ').trim();
}
